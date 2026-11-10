/**
 * @file authTokens.ts
 * @description Single-use emailed tokens (password reset, email verification and email change).
 * Only the SHA-256 of a token is stored; claiming one is a single atomic statement, so it works
 * exactly once. Each token is bound to the address it was emailed to: current-address tokens stop
 * working when the account email changes, and an email-change token only works while its address is
 * still the pending one.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { hashToken } from "./sessions.js";

export type AuthTokenType = "password_reset" | "email_verify" | "email_change";

export interface ConsumedAuthToken {
  userId: string;
  email: string;
  type: AuthTokenType;
}

/**
 * Issues a new token for a user, invalidating any earlier unused token of the same type.
 * @param user The account the token belongs to
 * @param type What the token authorizes
 * @param ttlMs How long it stays valid
 * @param destination Address the token is emailed to (defaults to the account's current email)
 * @returns The raw token (shown only once, to be emailed)
 */
export async function createAuthToken(
  user: { id: string; email: string },
  type: AuthTokenType,
  ttlMs: number,
  destination = user.email,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.authToken.deleteMany({ where: { userId: user.id, type, usedAt: null } }),
    prisma.authToken.create({
      data: {
        userId: user.id,
        type,
        email: destination,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    }),
  ]);
  return token;
}

/**
 * Atomically claims a token.
 * @returns The owner, address and type, or null if the token is unknown, of another type, expired,
 * already used, or no longer bound to the account's current/pending address.
 */
export async function consumeAuthToken(
  token: string,
  type: AuthTokenType,
): Promise<ConsumedAuthToken | null> {
  const tokenHash = hashToken(token);
  const claimed = await prisma.authToken.updateMany({
    where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;

  const row = await prisma.authToken.findUnique({
    where: { tokenHash },
    select: {
      userId: true,
      email: true,
      type: true,
      user: { select: { email: true, pendingEmail: true } },
    },
  });
  if (!row) return null;

  // A current-address token must still match the account; a change token must still match the
  // pending address (and must not be a no-op for the address the account already has).
  if (row.type === "email_change") {
    if (row.email !== row.user.pendingEmail || row.email === row.user.email) return null;
  } else if (row.email !== row.user.email) {
    return null;
  }

  return { userId: row.userId, email: row.email, type: row.type as AuthTokenType };
}

/**
 * Deletes every pending (unused) emailed token of a user. Meant to run inside the same
 * `prisma.$transaction` as an email or password change, so no earlier link survives it.
 */
export function deletePendingAuthTokensOp(userId: string) {
  return prisma.authToken.deleteMany({ where: { userId, usedAt: null } });
}

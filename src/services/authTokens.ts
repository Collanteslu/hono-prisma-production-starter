/**
 * @file authTokens.ts
 * @description Single-use emailed tokens (password reset, email verification). Only the SHA-256
 * of a token is stored; claiming one is a single atomic statement, so it works exactly once.
 * Each token is bound to the address it was emailed to and stops working if the account's email
 * changes; changing the email or the password also deletes every pending token.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { hashToken } from "./sessions.js";

export type AuthTokenType = "password_reset" | "email_verify";

/**
 * Issues a new token for a user, invalidating any earlier unused token of the same type.
 * @param user The account and the address the token is about to be emailed to
 * @returns The raw token (shown only once, to be emailed)
 */
export async function createAuthToken(
  user: { id: string; email: string },
  type: AuthTokenType,
  ttlMs: number,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.authToken.deleteMany({ where: { userId: user.id, type, usedAt: null } }),
    prisma.authToken.create({
      data: {
        userId: user.id,
        type,
        email: user.email,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    }),
  ]);
  return token;
}

/**
 * Atomically claims a token. @returns The owner's id, or null if the token is unknown, of
 * another type, expired, already used, or was emailed to an address the account no longer has.
 */
export async function consumeAuthToken(token: string, type: AuthTokenType): Promise<string | null> {
  const tokenHash = hashToken(token);
  const claimed = await prisma.authToken.updateMany({
    where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;
  const row = await prisma.authToken.findUnique({
    where: { tokenHash },
    select: { userId: true, email: true, user: { select: { email: true } } },
  });
  // A token sent to a previous address must not act on (or verify) the current one
  if (!row || row.email !== row.user.email) return null;
  return row.userId;
}

/**
 * Deletes every pending (unused) emailed token of a user. Meant to run inside the same
 * `prisma.$transaction` as an email or password change, so no earlier link survives it.
 */
export function deletePendingAuthTokensOp(userId: string) {
  return prisma.authToken.deleteMany({ where: { userId, usedAt: null } });
}

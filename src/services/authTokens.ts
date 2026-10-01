/**
 * @file authTokens.ts
 * @description Single-use emailed tokens (password reset, email verification). Only the SHA-256
 * of a token is stored; claiming one is a single atomic statement, so it works exactly once.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { hashToken } from "./sessions.js";

export type AuthTokenType = "password_reset" | "email_verify";

/**
 * Issues a new token for a user, invalidating any earlier unused token of the same type.
 * @returns The raw token (shown only once, to be emailed)
 */
export async function createAuthToken(
  userId: string,
  type: AuthTokenType,
  ttlMs: number,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.authToken.deleteMany({ where: { userId, type, usedAt: null } }),
    prisma.authToken.create({
      data: {
        userId,
        type,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    }),
  ]);
  return token;
}

/**
 * Atomically claims a token. @returns The owner's id, or null if the token is unknown, of
 * another type, expired or already used.
 */
export async function consumeAuthToken(token: string, type: AuthTokenType): Promise<string | null> {
  const tokenHash = hashToken(token);
  const claimed = await prisma.authToken.updateMany({
    where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;
  const row = await prisma.authToken.findUnique({ where: { tokenHash }, select: { userId: true } });
  return row?.userId ?? null;
}

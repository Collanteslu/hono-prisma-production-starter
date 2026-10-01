/**
 * @file sessions.ts
 * @description Session lifecycle: issuing token pairs, atomic refresh token rotation with
 * reuse detection, and revocation. Refresh tokens are persisted only as SHA-256 hashes.
 */

import { createHash, randomUUID } from "node:crypto";
import { sign } from "hono/jwt";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import type { Role } from "../types/index.js";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 15;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

interface TokenSubject {
  id: string;
  email: string;
  role: string;
}

export interface RefreshTokenPayload {
  userId: string;
  sessionId?: string;
}

/** SHA-256 digest used to look up refresh tokens without storing them in plaintext */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Signs an access + refresh pair. The session is absolute: its lifetime is fixed at login, so a
 * rotated refresh token never outlives `sessionExpiresAt` (defaults to a full TTL for new sessions).
 */
async function signTokenPair(user: TokenSubject, sessionId: string, sessionExpiresAt?: Date) {
  const nowSec = Math.floor(Date.now() / 1000);
  const refreshExp = sessionExpiresAt
    ? Math.floor(sessionExpiresAt.getTime() / 1000)
    : nowSec + SESSION_TTL_SECONDS;

  const accessToken = await sign(
    {
      userId: user.id,
      sessionId,
      email: user.email,
      role: user.role as Role,
      iat: nowSec,
      exp: nowSec + ACCESS_TOKEN_TTL_SECONDS,
    },
    env.JWT_SECRET,
    "HS256",
  );

  const refreshToken = await sign(
    {
      userId: user.id,
      sessionId,
      iat: nowSec,
      jti: randomUUID(),
      exp: refreshExp,
    },
    env.JWT_REFRESH_SECRET,
    "HS256",
  );

  return { accessToken, refreshToken, refreshExpiresAt: new Date(refreshExp * 1000) };
}

/**
 * Creates an active database session record and issues an Access + Refresh Token pair.
 */
export async function createSessionAndTokens(
  user: TokenSubject,
  userAgent?: string,
  ipAddress?: string,
) {
  const sessionId: string = randomUUID();
  const { accessToken, refreshToken, refreshExpiresAt } = await signTokenPair(user, sessionId);

  await prisma.$transaction([
    prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        userAgent: userAgent || "Unknown Client",
        ipAddress: ipAddress || "unknown",
        isActive: true,
        expiresAt: refreshExpiresAt,
      },
    }),
    prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(refreshToken),
        userId: user.id,
        sessionId,
        expiresAt: refreshExpiresAt,
      },
    }),
  ]);

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    sessionId,
  };
}

export type RotationResult =
  | { status: "rotated"; tokens: Awaited<ReturnType<typeof createSessionAndTokens>> }
  | { status: "invalid_account" }
  | { status: "session_inactive" }
  | { status: "concurrent" }
  | { status: "reused" };

/**
 * Exchanges a verified refresh token for a new pair (Token Rotation).
 *
 * - The token is claimed atomically (`usedAt IS NULL` guard), so it can only be rotated once.
 * - Re-presenting a token rotated within REFRESH_REUSE_GRACE_SECONDS is treated as a benign
 *   concurrent refresh (the other request already holds the new pair).
 * - Re-presenting it later (or an unknown token) is treated as theft: the session is revoked.
 */
export async function rotateRefreshToken(
  refreshToken: string,
  payload: RefreshTokenPayload,
): Promise<RotationResult> {
  const sessionId = payload.sessionId;
  if (!payload.userId || !sessionId) return { status: "session_inactive" };

  const now = new Date();
  const [user, session] = await Promise.all([
    prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true, isBlocked: true, deletedAt: true },
    }),
    prisma.session.findUnique({ where: { id: sessionId } }),
  ]);

  if (!user || user.isBlocked || user.deletedAt) return { status: "invalid_account" };
  if (!session?.isActive || session.userId !== user.id || session.expiresAt < now) {
    return { status: "session_inactive" };
  }

  const tokenHash = hashToken(refreshToken);
  const next = await signTokenPair(user, sessionId, session.expiresAt);

  const rotated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.refreshToken.updateMany({
      where: { tokenHash, sessionId, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return false;

    await tx.refreshToken.create({
      data: {
        tokenHash: hashToken(next.refreshToken),
        userId: user.id,
        sessionId,
        expiresAt: next.refreshExpiresAt,
      },
    });
    return true;
  });

  if (rotated) {
    return {
      status: "rotated",
      tokens: {
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        sessionId,
      },
    };
  }

  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  const graceMs = env.REFRESH_REUSE_GRACE_SECONDS * 1000;
  if (stored?.usedAt && now.getTime() - stored.usedAt.getTime() <= graceMs) {
    return { status: "concurrent" };
  }

  // Token Reuse Detection: a validly signed but already-rotated/revoked token was replayed
  await revokeSession(sessionId);
  return { status: "reused" };
}

/**
 * Deactivates a session and purges its refresh tokens atomically.
 */
export async function revokeSession(sessionId: string) {
  const [sessions] = await prisma.$transaction([
    prisma.session.updateMany({
      where: { id: sessionId, isActive: true },
      data: { isActive: false },
    }),
    prisma.refreshToken.deleteMany({ where: { sessionId } }),
  ]);
  return sessions.count;
}

/**
 * Batch operations that deactivate all sessions of a user (optionally keeping one) and purge
 * their refresh tokens. Returned un-awaited so callers can compose them into one transaction.
 */
export function userSessionRevocationOps(userId: string, options?: { exceptSessionId?: string }) {
  const except = options?.exceptSessionId;
  return [
    prisma.session.updateMany({
      where: { userId, isActive: true, ...(except && { id: { not: except } }) },
      data: { isActive: false },
    }),
    prisma.refreshToken.deleteMany({
      where: except
        ? { userId, OR: [{ sessionId: null }, { sessionId: { not: except } }] }
        : { userId },
    }),
  ] as const;
}

/**
 * Deactivates all sessions of a user (optionally keeping one) and purges their refresh tokens.
 * @returns Number of sessions revoked
 */
export async function revokeUserSessions(userId: string, options?: { exceptSessionId?: string }) {
  const [sessions] = await prisma.$transaction([...userSessionRevocationOps(userId, options)]);
  return sessions.count;
}

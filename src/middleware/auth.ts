/**
 * @file auth.ts
 * @description Authentication and authorization middleware with stateful session checking and real-time user blocking.
 *
 * Architecture Highlights:
 * 1. Cryptographic validation: Verifies the JWT signature using Hono's native `verify()` helper.
 * 2. Real-time Block Checking: Queries SQLite to verify that `user.isBlocked !== true`.
 *    If an administrator suspends an account, active tokens are blocked immediately.
 * 3. Stateful Session Validation: Validates that the `sessionId` exists and remains active (`session.isActive === true`).
 *    Allows instant session revocation without waiting for the JWT expiry.
 */

import type { Context, Next } from "hono";
import { verify } from "hono/jwt";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { errorResponse } from "../lib/response.js";
import type { AppEnv, JwtPayload, Role } from "../types/index.js";

export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header("Authorization");

  // Verify Bearer schema structure
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse(
      c,
      "Unauthorized: Missing or malformed Bearer Token in Authorization header.",
      401,
    );
  }

  const token = authHeader.slice("Bearer ".length).trim();

  let payload: JwtPayload;
  try {
    // Decode and cryptographically verify the JWT signature
    payload = (await verify(token, env.JWT_SECRET, "HS256")) as unknown as JwtPayload;
  } catch {
    return errorResponse(c, "Invalid or expired authentication token.", 401);
  }

  // Every access token must be bound to a session so it can be revoked in real time
  if (!payload.userId || !payload.sessionId) {
    return errorResponse(c, "Invalid or expired authentication token.", 401);
  }

  const [user, session] = await Promise.all([
    prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, role: true, isBlocked: true, blockedReason: true, deletedAt: true },
    }),
    prisma.session.findUnique({
      where: { id: payload.sessionId },
      select: { userId: true, isActive: true, expiresAt: true },
    }),
  ]);

  // 1. Verify user existence and real-time suspension state
  if (!user || user.deletedAt) {
    return errorResponse(
      c,
      "Unauthorized: Account associated with this token no longer exists.",
      401,
    );
  }

  if (user.isBlocked) {
    return errorResponse(
      c,
      `Access denied: Account has been suspended. Reason: ${user.blockedReason || "Policy violation"}.`,
      403,
    );
  }

  // 2. Stateful session check: Verify that the session is active and belongs to the user
  if (!session?.isActive || session.userId !== user.id || session.expiresAt < new Date()) {
    return errorResponse(c, "Session has been revoked or expired. Please sign in again.", 401);
  }

  // Attach identity to context; the role comes from the database so role changes apply immediately
  c.set("user", { ...payload, role: user.role as Role });
  await next();
}

/**
 * Restricts a route to administrators. Must run after authMiddleware.
 */
export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  if (c.get("user").role !== "admin") {
    return errorResponse(c, "Forbidden: This action requires administrator privileges.", 403);
  }
  await next();
}

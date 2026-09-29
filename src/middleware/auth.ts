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
import type { AppEnv, JwtPayload } from "../types/index.js";

export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header("Authorization");

  // Verify Bearer schema structure
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json(
      {
        success: false,
        message: "Unauthorized: Missing or malformed Bearer Token in Authorization header.",
      },
      401,
    );
  }

  const token = authHeader.split(" ")[1];

  try {
    // Decode and cryptographically verify the JWT signature
    const payload = (await verify(token, env.JWT_SECRET, "HS256")) as unknown as JwtPayload;

    // 1. Verify user existence and real-time suspension state
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, isBlocked: true, blockedReason: true },
    });

    if (!user) {
      return c.json(
        {
          success: false,
          message: "Unauthorized: Account associated with this token no longer exists.",
        },
        401,
      );
    }

    if (user.isBlocked) {
      return c.json(
        {
          success: false,
          message: `Access denied: Account has been suspended. Reason: ${user.blockedReason || "Policy violation"}.`,
        },
        403,
      );
    }

    // 2. Stateful session check: Verify that the session is active in database
    if (payload.sessionId) {
      const session = await prisma.session.findUnique({
        where: { id: payload.sessionId },
      });

      if (!session?.isActive || session.expiresAt < new Date()) {
        return c.json(
          {
            success: false,
            message: "Session has been revoked or expired. Please sign in again.",
          },
          401,
        );
      }
    }

    // Attach decoded user identity to context
    c.set("user", payload);
    await next();
  } catch (error) {
    return c.json(
      {
        success: false,
        message: "Invalid or expired authentication token.",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      401,
    );
  }
}

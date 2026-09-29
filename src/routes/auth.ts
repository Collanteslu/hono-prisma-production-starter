/**
 * @file auth.ts
 * @description Authentication endpoints providing registration, login, token refresh with rotation, and logout.
 * Includes database-persisted session tracking and brute-force protection via rate limiting.
 */

import { Hono } from "hono";
import { verify } from "hono/jwt";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { recordAudit } from "../lib/audit.js";
import { getClientIp } from "../lib/clientIp.js";
import { buildMeta, errorResponse, successResponse } from "../lib/response.js";
import { validate } from "../lib/validator.js";
import { createLoginLockout, rateLimiter } from "../middleware/rateLimit.js";
import { loginSchema, logoutSchema, refreshTokenSchema, registerSchema } from "../schemas/index.js";
import {
  createSessionAndTokens,
  hashToken,
  type RefreshTokenPayload,
  revokeSession,
  rotateRefreshToken,
} from "../services/sessions.js";
import type { AppEnv } from "../types/index.js";
import { comparePassword, getDummyHash, hashPassword } from "../utils/password.js";

export const authRoutes = new Hono<AppEnv>();

// Per-IP rate limiting on sensitive endpoints
authRoutes.use("/login", rateLimiter(60_000, env.LOGIN_RATE_LIMIT_MAX));
authRoutes.use("/refresh", rateLimiter(60_000, env.REFRESH_RATE_LIMIT_MAX));
authRoutes.use("/register", rateLimiter(60 * 60_000, env.REGISTER_RATE_LIMIT_MAX));

// Per-account lockout: 5 failed passwords lock the account for 15 minutes
const loginLockout = createLoginLockout();

/**
 * POST /api/auth/register
 * Public self-service registration. Accounts are always created with the "user" role.
 */
authRoutes.post(
  "/register",
  validate("json", registerSchema, "Validation error when registering account"),
  async (c) => {
    const { name, email, password } = c.req.valid("json");

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return errorResponse(c, `Email '${email}' is already registered.`, 409);
    }

    const newUser = await prisma.user.create({
      data: { name, email, password: await hashPassword(password), role: "user" },
    });

    await recordAudit(c, {
      userId: newUser.id,
      action: "REGISTER",
      entity: "User",
      entityId: newUser.id,
    });

    return successResponse(c, newUser, {
      status: 201,
      message: "Account registered successfully.",
    });
  },
);

/**
 * POST /api/auth/login
 * Validates user credentials, ensures account is not blocked, and establishes an active session.
 */
authRoutes.post("/login", validate("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");

  const lockedForSeconds = loginLockout.retryAfterSeconds(email);
  if (lockedForSeconds > 0) {
    c.header("Retry-After", lockedForSeconds.toString());
    return errorResponse(
      c,
      "Too many failed login attempts for this account. Please try again later.",
      429,
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    omit: { password: false },
  });

  // Constant-time bcrypt comparison (always executed to prevent timing side-channel leaks)
  const isValidPassword = await comparePassword(password, user?.password ?? (await getDummyHash()));

  if (!user || !isValidPassword || user.deletedAt) {
    loginLockout.recordFailure(email);
    await recordAudit(c, {
      userId: user?.id ?? null,
      action: "LOGIN_FAILED",
      entity: "Session",
      details: { email },
    });
    return errorResponse(c, "Invalid credentials (incorrect email or password)", 401);
  }

  loginLockout.reset(email);

  // Verify account suspension status after password check to prevent status enumeration
  if (user.isBlocked) {
    return errorResponse(c, "Account has been suspended. Please contact support.", 403);
  }

  const sessionData = await createSessionAndTokens(
    user,
    c.req.header("user-agent"),
    getClientIp(c),
  );

  await recordAudit(c, {
    userId: user.id,
    action: "LOGIN",
    entity: "Session",
    entityId: sessionData.sessionId,
  });

  return c.json({
    success: true,
    message: "Authentication successful",
    ...sessionData,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    meta: buildMeta(c),
  });
});

/**
 * POST /api/auth/refresh
 * Exchanges a valid Refresh Token for a new token pair using Token Rotation.
 */
authRoutes.post(
  "/refresh",
  validate("json", refreshTokenSchema, "Missing or invalid refresh token payload"),
  async (c) => {
    const { refreshToken } = c.req.valid("json");

    let payload: RefreshTokenPayload;
    try {
      payload = (await verify(
        refreshToken,
        env.JWT_REFRESH_SECRET,
        "HS256",
      )) as unknown as RefreshTokenPayload;
    } catch {
      return errorResponse(c, "Corrupted or invalid refresh token.", 401);
    }

    const result = await rotateRefreshToken(refreshToken, payload);

    switch (result.status) {
      case "rotated":
        return c.json({
          success: true,
          message: "Tokens renewed successfully (Token Rotation)",
          ...result.tokens,
          meta: buildMeta(c),
        });
      case "invalid_account":
        return errorResponse(
          c,
          "Access denied: Account does not exist or has been suspended.",
          403,
        );
      case "session_inactive":
        return errorResponse(c, "Session has been revoked or expired. Please sign in again.", 401);
      case "concurrent":
        return errorResponse(
          c,
          "Refresh token was already rotated by a concurrent request. Use the most recent token pair.",
          409,
        );
      case "reused":
        await recordAudit(c, {
          userId: payload.userId,
          action: "TOKEN_REUSE_DETECTED",
          entity: "Session",
          entityId: payload.sessionId ?? null,
        });
        return errorResponse(
          c,
          "Security alert: Refresh token has already been used or revoked. Session terminated.",
          401,
        );
    }
  },
);

/**
 * POST /api/auth/logout
 * Deactivates session record in SQLite and purges associated refresh tokens.
 */
authRoutes.post("/logout", validate("json", logoutSchema), async (c) => {
  const { refreshToken } = c.req.valid("json");
  const authHeader = c.req.header("Authorization");
  const revoked = new Map<string, string>(); // sessionId -> userId

  // 1. If called with a Bearer token, terminate the current session
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const payload = (await verify(
        authHeader.slice("Bearer ".length).trim(),
        env.JWT_SECRET,
        "HS256",
      )) as unknown as RefreshTokenPayload;
      if (payload.sessionId) revoked.set(payload.sessionId, payload.userId);
    } catch {
      // An expired/invalid access token must not prevent logout via refresh token
    }
  }

  // 2. If a refresh token was provided, revoke the session it belongs to
  if (refreshToken) {
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
    });
    if (stored?.sessionId) revoked.set(stored.sessionId, stored.userId);
    else if (stored) await prisma.refreshToken.delete({ where: { id: stored.id } });
  }

  for (const [sessionId, userId] of revoked) {
    await revokeSession(sessionId);
    await recordAudit(c, { userId, action: "LOGOUT", entity: "Session", entityId: sessionId });
  }

  return successResponse(c, null, { message: "Logged out successfully. Session revoked." });
});

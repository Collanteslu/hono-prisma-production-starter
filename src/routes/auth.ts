/**
 * @file auth.ts
 * @description Authentication endpoints providing login, token refresh with rotation, and logout.
 * Includes database-persisted session tracking and brute-force protection via rate limiting.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { buildMeta } from "../lib/response.js";
import { rateLimiter } from "../middleware/rateLimit.js";
import { loginSchema, logoutSchema, refreshTokenSchema } from "../schemas/index.js";
import type { AppEnv } from "../types/index.js";
import { comparePassword } from "../utils/password.js";

export const authRoutes = new Hono<AppEnv>();

// Apply strict rate limiting on login endpoint (10 requests / minute)
authRoutes.use("/login", rateLimiter(60_000, 30));

/**
 * Creates an active database session record and issues an Access + Refresh Token pair.
 * @param user Authenticated user entity
 * @param userAgent Device User-Agent header string
 * @param ipAddress Remote IP address
 */
async function createSessionAndTokens(
  user: { id: string; email: string; role: string },
  userAgent?: string,
  ipAddress?: string,
) {
  const nowSec = Math.floor(Date.now() / 1000);

  // 1. Create session record in SQLite (7 days lifetime)
  const sessionExpDate = new Date((nowSec + 60 * 60 * 24 * 7) * 1000);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      userAgent: userAgent || "Unknown Client",
      ipAddress: ipAddress || "localhost",
      isActive: true,
      expiresAt: sessionExpDate,
    },
  });

  // 2. Access Token (15 minutes lifespan) tied to the active sessionId
  const accessExp = nowSec + 60 * 15;
  const accessToken = await sign(
    {
      userId: user.id,
      sessionId: session.id,
      email: user.email,
      role: user.role,
      exp: accessExp,
    },
    env.JWT_SECRET,
    "HS256",
  );

  // 3. Refresh Token (7 days lifespan) tied to the session
  const refreshExp = nowSec + 60 * 60 * 24 * 7;
  const refreshToken = await sign(
    {
      userId: user.id,
      sessionId: session.id,
      email: user.email,
      role: user.role,
      iat: nowSec,
      nonce: Math.random().toString(36).substring(2, 10),
      exp: refreshExp,
    },
    env.JWT_REFRESH_SECRET,
    "HS256",
  );

  // 4. Persist refresh token in database
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      sessionId: session.id,
      expiresAt: new Date(refreshExp * 1000),
    },
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: 60 * 15,
    sessionId: session.id,
  };
}

/**
 * POST /api/auth/login
 * Validates user credentials, ensures account is not blocked, and establishes an active session.
 */
authRoutes.post(
  "/login",
  zValidator("json", loginSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: "Validation error in request payload",
          errors: result.error.flatten().fieldErrors,
        },
        400,
      );
    }
  }),
  async (c) => {
    const { email, password } = c.req.valid("json");

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return c.json(
        {
          success: false,
          message: "Invalid credentials (incorrect email or password)",
        },
        401,
      );
    }

    // Verify account suspension status
    if (user.isBlocked) {
      return c.json(
        {
          success: false,
          message: `Access denied: Account has been suspended. Reason: ${user.blockedReason || "Contact support"}.`,
        },
        403,
      );
    }

    // Constant-time bcrypt hash comparison
    const isValidPassword = await comparePassword(password, user.password);

    if (!isValidPassword) {
      return c.json(
        {
          success: false,
          message: "Invalid credentials (incorrect email or password)",
        },
        401,
      );
    }

    const userAgent = c.req.header("user-agent");
    const ipAddress =
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
      c.req.header("x-real-ip") ||
      "localhost";

    const sessionData = await createSessionAndTokens(user, userAgent, ipAddress);

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
  },
);

/**
 * POST /api/auth/refresh
 * Exchanges a valid Refresh Token for a new token pair using Token Rotation.
 */
authRoutes.post(
  "/refresh",
  zValidator("json", refreshTokenSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: "Missing or invalid refresh token payload",
          errors: result.error.flatten().fieldErrors,
        },
        400,
      );
    }
  }),
  async (c) => {
    const { refreshToken } = c.req.valid("json");

    try {
      const payload = (await verify(refreshToken, env.JWT_REFRESH_SECRET, "HS256")) as unknown as {
        userId: string;
        sessionId?: string;
      };

      // 1. Check account suspension status
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
      });

      if (!user || user.isBlocked) {
        return c.json(
          {
            success: false,
            message: "Access denied: Account does not exist or has been suspended.",
          },
          403,
        );
      }

      // 2. Verify that parent session remains active
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

      // 3. Verify that refresh token exists in database and has not expired
      const storedToken = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
      });

      if (!storedToken || storedToken.expiresAt < new Date()) {
        return c.json(
          {
            success: false,
            message: "Refresh token expired or revoked. Please sign in again.",
          },
          401,
        );
      }

      // 4. Token Rotation: Invalidate used refresh token and issue a fresh pair
      await prisma.refreshToken.delete({
        where: { id: storedToken.id },
      });

      const nowSec = Math.floor(Date.now() / 1000);
      const accessExp = nowSec + 60 * 15;
      const newAccessToken = await sign(
        {
          userId: user.id,
          sessionId: payload.sessionId || "",
          email: user.email,
          role: user.role,
          exp: accessExp,
        },
        env.JWT_SECRET,
        "HS256",
      );

      const refreshExp = nowSec + 60 * 60 * 24 * 7;
      const newRefreshToken = await sign(
        {
          userId: user.id,
          sessionId: payload.sessionId || "",
          email: user.email,
          role: user.role,
          iat: nowSec,
          nonce: Math.random().toString(36).substring(2, 10),
          exp: refreshExp,
        },
        env.JWT_REFRESH_SECRET,
        "HS256",
      );

      await prisma.refreshToken.create({
        data: {
          token: newRefreshToken,
          userId: user.id,
          sessionId: payload.sessionId,
          expiresAt: new Date(refreshExp * 1000),
        },
      });

      return c.json({
        success: true,
        message: "Tokens renewed successfully (Token Rotation)",
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 60 * 15,
        sessionId: payload.sessionId,
        meta: buildMeta(c),
      });
    } catch (_err) {
      return c.json(
        {
          success: false,
          message: "Corrupted or invalid refresh token.",
        },
        401,
      );
    }
  },
);

/**
 * POST /api/auth/logout
 * Deactivates session record in SQLite and purges associated refresh tokens.
 */
authRoutes.post("/logout", zValidator("json", logoutSchema), async (c) => {
  const { refreshToken } = c.req.valid("json");
  const authHeader = c.req.header("Authorization");

  try {
    // 1. If called with Bearer Token, terminate the current session
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      try {
        const payload = (await verify(token, env.JWT_SECRET, "HS256")) as unknown as {
          sessionId?: string;
        };
        if (payload.sessionId) {
          await prisma.session.update({
            where: { id: payload.sessionId },
            data: { isActive: false },
          });
          await prisma.refreshToken.deleteMany({
            where: { sessionId: payload.sessionId },
          });
        }
      } catch (_) {}
    }

    // 2. If a refreshToken was passed in payload, revoke its session
    if (refreshToken) {
      const stored = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
      });
      if (stored?.sessionId) {
        await prisma.session.updateMany({
          where: { id: stored.sessionId },
          data: { isActive: false },
        });
      }
      await prisma.refreshToken.deleteMany({
        where: { token: refreshToken },
      });
    }

    return c.json({
      success: true,
      message: "Logged out successfully. Session revoked.",
    });
  } catch (_error) {
    return c.json(
      {
        success: false,
        message: "Error processing logout request.",
      },
      500,
    );
  }
});

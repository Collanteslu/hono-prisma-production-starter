/**
 * @file auth.ts
 * @description Authentication endpoints providing registration, login, token refresh with rotation, and logout.
 * Includes database-persisted session tracking and brute-force protection via rate limiting.
 */

import { createRoute } from "@hono/zod-openapi";
import { verify } from "hono/jwt";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { recordAudit } from "../lib/audit.js";
import { getClientIp } from "../lib/clientIp.js";
import { createRouter, errorResponses, jsonBody, jsonResponse } from "../lib/openapi.js";
import { buildMeta, errorResponse, successResponse } from "../lib/response.js";
import { createLoginLockout, rateLimiter } from "../middleware/rateLimit.js";
import { loginSchema, logoutSchema, refreshTokenSchema, registerSchema } from "../schemas/index.js";
import {
  loginResponseSchema,
  refreshResponseSchema,
  successSchema,
  userSchema,
} from "../schemas/responses.js";
import {
  createSessionAndTokens,
  hashToken,
  type RefreshTokenPayload,
  revokeSession,
  rotateRefreshToken,
} from "../services/sessions.js";
import { comparePassword, getDummyHash, hashPassword } from "../utils/password.js";

export const authRoutes = createRouter();

// Per-IP rate limiting on sensitive endpoints
authRoutes.use("/login", rateLimiter(60_000, env.LOGIN_RATE_LIMIT_MAX));
authRoutes.use("/refresh", rateLimiter(60_000, env.REFRESH_RATE_LIMIT_MAX));
authRoutes.use("/register", rateLimiter(60 * 60_000, env.REGISTER_RATE_LIMIT_MAX));

// Per-account lockout: 5 failed passwords lock the account for 15 minutes
const loginLockout = createLoginLockout();

const registerRoute = createRoute({
  method: "post",
  path: "/register",
  tags: ["Auth"],
  summary: "Registro público de cuentas",
  description:
    "Crea una cuenta con rol `user` (cualquier `role` enviado se ignora). Rate limit por IP (5/hora por defecto).",
  request: jsonBody(registerSchema),
  responses: {
    201: jsonResponse(successSchema(userSchema), "Cuenta creada"),
    ...errorResponses({
      400: "Error de validación",
      409: "Email duplicado",
      429: "Rate limit excedido",
    }),
  },
});

/**
 * POST /api/auth/register
 * Public self-service registration. Accounts are always created with the "user" role.
 */
authRoutes.openapi(registerRoute, async (c) => {
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

  return successResponse(c, newUser, { status: 201, message: "Account registered successfully." });
});

const loginRoute = createRoute({
  method: "post",
  path: "/login",
  tags: ["Auth"],
  summary: "Inicio de sesión (Login)",
  description:
    "Autentica credenciales y emite Access Token (15 min) y Refresh Token (7 días). Protegido por rate limit por IP y bloqueo por cuenta tras 5 intentos fallidos (15 min).",
  request: jsonBody(loginSchema),
  responses: {
    200: jsonResponse(loginResponseSchema, "Login exitoso"),
    ...errorResponses({
      400: "Error de validación o JSON mal formado",
      401: "Credenciales inválidas",
      403: "Cuenta suspendida",
      429: "Rate limit excedido o cuenta bloqueada temporalmente",
    }),
  },
});

/**
 * POST /api/auth/login
 * Validates user credentials, ensures account is not blocked, and establishes an active session.
 */
authRoutes.openapi(loginRoute, async (c) => {
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

  return c.json(
    {
      success: true as const,
      message: "Authentication successful",
      ...sessionData,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      meta: buildMeta(c),
    },
    200,
  );
});

const refreshRoute = createRoute({
  method: "post",
  path: "/refresh",
  tags: ["Auth"],
  summary: "Renovar Access Token (Token Rotation)",
  description:
    "Intercambia un Refresh Token válido por un nuevo par de tokens. Cada refresh token solo puede usarse una vez: reutilizarlo dentro del periodo de gracia devuelve 409 (refresh concurrente); después se considera robo y la sesión se revoca.",
  request: jsonBody(refreshTokenSchema),
  responses: {
    200: jsonResponse(refreshResponseSchema, "Tokens renovados"),
    ...errorResponses({
      400: "Error de validación",
      401: "Refresh token inválido, expirado, revocado o reutilizado",
      403: "Cuenta suspendida o eliminada",
      409: "El token ya fue rotado por una petición concurrente",
      429: "Rate limit excedido",
    }),
  },
});

/**
 * POST /api/auth/refresh
 * Exchanges a valid Refresh Token for a new token pair using Token Rotation.
 */
authRoutes.openapi(refreshRoute, async (c) => {
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
      return c.json(
        {
          success: true as const,
          message: "Tokens renewed successfully (Token Rotation)",
          ...result.tokens,
          meta: buildMeta(c),
        },
        200,
      );
    case "invalid_account":
      return errorResponse(c, "Access denied: Account does not exist or has been suspended.", 403);
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
});

const logoutRoute = createRoute({
  method: "post",
  path: "/logout",
  tags: ["Auth"],
  summary: "Cierre de sesión (Logout)",
  description:
    "Revoca la sesión asociada al Bearer token y/o al refresh token enviado (ambos opcionales).",
  request: jsonBody(logoutSchema),
  responses: {
    200: jsonResponse(successSchema(userSchema.nullable()), "Sesión revocada"),
    ...errorResponses({ 400: "Error de validación" }),
  },
});

/**
 * POST /api/auth/logout
 * Deactivates session record in SQLite and purges associated refresh tokens.
 */
authRoutes.openapi(logoutRoute, async (c) => {
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

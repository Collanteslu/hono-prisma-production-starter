/**
 * @file recovery.ts
 * @description Password recovery and email verification (mounted under /api/auth).
 * Requests that start a flow always answer 202 whether or not the account exists, and the email
 * is sent in the background, so neither the body nor the latency reveals which addresses exist.
 */

import { createRoute, z } from "@hono/zod-openapi";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { recordAudit } from "../lib/audit.js";
import { createRouter, errorResponses, jsonBody, jsonResponse } from "../lib/openapi.js";
import { clearBucket, hitBucket } from "../lib/rateLimitStore.js";
import { buildMeta, errorResponse, successResponse } from "../lib/response.js";
import { rateLimiter } from "../middleware/rateLimit.js";
import {
  forgotPasswordSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "../schemas/index.js";
import { successSchema } from "../schemas/responses.js";
import {
  inBackground,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../services/accountMail.js";
import { consumeAuthToken } from "../services/authTokens.js";
import { userSessionRevocationOps } from "../services/sessions.js";
import { hashPassword } from "../utils/password.js";

const router = createRouter();

// Per-IP limits, plus a per-address throttle inside the handlers (a stranger cannot flood an inbox)
router.use(
  "/forgot-password",
  rateLimiter("forgot-password", 60 * 60_000, env.RECOVERY_RATE_LIMIT_MAX),
);
router.use(
  "/reset-password",
  rateLimiter("reset-password", 60 * 60_000, env.RECOVERY_RATE_LIMIT_MAX * 2),
);
router.use(
  "/resend-verification",
  rateLimiter("resend-verification", 60 * 60_000, env.RECOVERY_RATE_LIMIT_MAX),
);
router.use(
  "/verify-email",
  rateLimiter("verify-email", 60 * 60_000, env.RECOVERY_RATE_LIMIT_MAX * 3),
);

const EMAILS_PER_ADDRESS_PER_HOUR = 3;

/** True while the address is under its hourly allowance for this kind of email */
async function mayEmail(kind: string, email: string): Promise<boolean> {
  const bucket = await hitBucket(`mail:${kind}:${email}`, 60 * 60_000);
  return bucket.count <= EMAILS_PER_ADDRESS_PER_HOUR;
}

const accepted = jsonResponse(
  successSchema(z.null()),
  "Solicitud aceptada (se responde igual exista o no la cuenta)",
);

const forgotRoute = createRoute({
  method: "post",
  path: "/forgot-password",
  tags: ["Auth"],
  summary: "Solicitar recuperación de contraseña",
  description:
    "Si existe una cuenta activa con ese email, se le envía un enlace de un solo uso (válido `PASSWORD_RESET_TTL_MINUTES`). La respuesta es siempre 202, exista o no la cuenta.",
  request: jsonBody(forgotPasswordSchema),
  responses: {
    202: accepted,
    ...errorResponses({ 400: "Error de validación", 429: "Rate limit excedido" }),
  },
});

const resetRoute = createRoute({
  method: "post",
  path: "/reset-password",
  tags: ["Auth"],
  summary: "Restablecer la contraseña con el token recibido",
  description:
    "Cambia la contraseña, revoca todas las sesiones de la cuenta y desbloquea el login. El 2FA, si está activo, se sigue exigiendo.",
  request: jsonBody(resetPasswordSchema),
  responses: {
    200: jsonResponse(successSchema(z.null()), "Contraseña restablecida"),
    ...errorResponses({
      400: "Token inválido, caducado o ya usado, o contraseña inválida",
      429: "Rate limit excedido",
    }),
  },
});

const verifyRoute = createRoute({
  method: "post",
  path: "/verify-email",
  tags: ["Auth"],
  summary: "Verificar el email con el token recibido",
  request: jsonBody(verifyEmailSchema),
  responses: {
    200: jsonResponse(successSchema(z.null()), "Email verificado"),
    ...errorResponses({ 400: "Token inválido, caducado o ya usado", 429: "Rate limit excedido" }),
  },
});

const resendRoute = createRoute({
  method: "post",
  path: "/resend-verification",
  tags: ["Auth"],
  summary: "Reenviar el email de verificación",
  description: "Respuesta 202 siempre. Máximo 3 correos por dirección y hora.",
  request: jsonBody(resendVerificationSchema),
  responses: {
    202: accepted,
    ...errorResponses({ 400: "Error de validación", 429: "Rate limit excedido" }),
  },
});

export const recoveryRoutes = router
  .openapi(forgotRoute, async (c) => {
    const { email } = c.req.valid("json");

    inBackground(async () => {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || user.deletedAt || user.isBlocked) return;
      if (!(await mayEmail("reset", email))) return;
      await sendPasswordResetEmail(user);
      await recordAudit(c, {
        userId: user.id,
        action: "PASSWORD_RESET_REQUESTED",
        entity: "User",
        entityId: user.id,
      });
    });

    return c.json(
      {
        success: true as const,
        message: "If an account exists for that email, a reset link has been sent.",
        data: null,
        meta: buildMeta(c),
      },
      202,
    );
  })
  .openapi(resetRoute, async (c) => {
    const { token, password } = c.req.valid("json");

    const userId = await consumeAuthToken(token, "password_reset");
    const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
    if (!user || user.deletedAt || user.isBlocked) {
      return errorResponse(c, "Invalid or expired reset token.", 400);
    }

    // New password + revocation of every session in one transaction
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          password: await hashPassword(password),
          // Whoever received the email controls the mailbox
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
      }),
      ...userSessionRevocationOps(user.id),
    ]);
    await clearBucket(`lockout:${user.email}`);

    await recordAudit(c, {
      userId: user.id,
      action: "PASSWORD_RESET",
      entity: "User",
      entityId: user.id,
    });
    return successResponse(c, null, { message: "Password updated. Please sign in again." });
  })
  .openapi(verifyRoute, async (c) => {
    const { token } = c.req.valid("json");

    const userId = await consumeAuthToken(token, "email_verify");
    if (!userId) return errorResponse(c, "Invalid or expired verification token.", 400);

    await prisma.user.updateMany({
      where: { id: userId, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });
    await recordAudit(c, { userId, action: "EMAIL_VERIFIED", entity: "User", entityId: userId });
    return successResponse(c, null, { message: "Email verified." });
  })
  .openapi(resendRoute, async (c) => {
    const { email } = c.req.valid("json");

    inBackground(async () => {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || user.deletedAt || user.emailVerifiedAt) return;
      if (!(await mayEmail("verify", email))) return;
      await sendVerificationEmail(user);
    });

    return c.json(
      {
        success: true as const,
        message: "If the account exists and is not verified, a new link has been sent.",
        data: null,
        meta: buildMeta(c),
      },
      202,
    );
  });

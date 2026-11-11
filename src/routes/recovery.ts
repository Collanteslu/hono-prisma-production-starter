/**
 * @file recovery.ts
 * @description Password recovery and email verification (mounted under /api/auth).
 * Requests that start a flow always answer 202 whether or not the account exists, and the email
 * is sent in the background, so neither the body nor the latency reveals which addresses exist.
 */

import { createRoute, z } from "@hono/zod-openapi";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { Prisma } from "../generated/client/client.js";
import { recordAudit } from "../lib/audit.js";
import { createRouter, errorResponses, jsonBody, jsonResponse } from "../lib/openapi.js";
import { clearBucket, hitBucket } from "../lib/rateLimitStore.js";
import { errorResponse, successResponse } from "../lib/response.js";
import {
  passwordConfirmKey,
  passwordConfirmLockout,
  rateLimiter,
} from "../middleware/rateLimit.js";
import {
  forgotPasswordSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "../schemas/index.js";
import { successSchema } from "../schemas/responses.js";
import {
  inBackground,
  sendEmailChangedNotice,
  sendEmailChangeVerification,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../services/accountMail.js";
import { consumeAuthToken, deletePendingAuthTokensOp } from "../services/authTokens.js";
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
    ...errorResponses({
      400: "Token inválido, caducado o ya usado",
      409: "La nueva dirección ya está ocupada por otra cuenta",
      429: "Rate limit excedido",
    }),
  },
});

const resendRoute = createRoute({
  method: "post",
  path: "/resend-verification",
  tags: ["Auth"],
  summary: "Reenviar el email de verificación",
  description:
    "Respuesta 202 siempre. Si hay un cambio de email pendiente, reenvía el enlace a la nueva dirección. Máximo 3 correos por dirección y hora.",
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

    return successResponse(c, null, {
      message: "If an account exists for that email, a reset link has been sent.",
      status: 202,
    });
  })
  .openapi(resetRoute, async (c) => {
    const { token, password } = c.req.valid("json");

    const consumed = await consumeAuthToken(token, "password_reset");
    const user = consumed ? await prisma.user.findUnique({ where: { id: consumed.userId } }) : null;
    if (!user || user.deletedAt || user.isBlocked) {
      return errorResponse(c, "Invalid or expired reset token.", 400);
    }

    // New password + revocation of every session and pending emailed token in one transaction
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          password: await hashPassword(password),
          // Whoever received the email controls the mailbox (the token is bound to this address)
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          // A pending email change is cancelled by a password reset
          pendingEmail: null,
        },
      }),
      deletePendingAuthTokensOp(user.id),
      ...userSessionRevocationOps(user.id),
    ]);
    // Unlock the account for the new password: both the login lockout and the password-confirmation
    // lockout (PUT /api/users/:id, /mfa/setup, /mfa/disable) key on this same account
    await clearBucket(`lockout:${user.email}`);
    await passwordConfirmLockout.reset(passwordConfirmKey(user.id));

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

    // The endpoint serves both flows: verifying the current address and confirming a pending one.
    const consumed =
      (await consumeAuthToken(token, "email_verify")) ??
      (await consumeAuthToken(token, "email_change"));
    if (!consumed) return errorResponse(c, "Invalid or expired verification token.", 400);

    if (consumed.type === "email_verify") {
      await prisma.user.updateMany({
        where: { id: consumed.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
      await recordAudit(c, {
        userId: consumed.userId,
        action: "EMAIL_VERIFIED",
        entity: "User",
        entityId: consumed.userId,
      });
      return successResponse(c, null, { message: "Email verified." });
    }

    const user = await prisma.user.findUnique({
      where: { id: consumed.userId },
      select: {
        id: true,
        name: true,
        email: true,
        pendingEmail: true,
        isBlocked: true,
        deletedAt: true,
      },
    });
    if (
      !user ||
      user.isBlocked ||
      user.deletedAt ||
      user.pendingEmail !== consumed.email ||
      user.email === consumed.email
    ) {
      return errorResponse(c, "Invalid or expired verification token.", 400);
    }

    // The address may have been taken after the request; do not overwrite another account.
    const taken = await prisma.user.findFirst({
      where: { email: consumed.email, id: { not: user.id } },
      select: { id: true },
    });
    if (taken) {
      await prisma.user.update({ where: { id: user.id }, data: { pendingEmail: null } });
      return errorResponse(c, "That email address is already in use by another account.", 409);
    }

    const oldEmail = user.email;
    try {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: {
            email: consumed.email,
            pendingEmail: null,
            // The link proves control of the new mailbox
            emailVerifiedAt: new Date(),
          },
        }),
        deletePendingAuthTokensOp(user.id),
        // The address controls password recovery: every device must sign in again with it.
        ...userSessionRevocationOps(user.id),
      ]);
    } catch (error) {
      // The check above is only a fast path: another account can claim the address before this
      // transaction commits. The unique index is the final authority; clear the now-useless pending
      // address and answer the same 409 instead of the generic constraint error.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        await prisma.user.updateMany({
          where: { id: user.id, pendingEmail: consumed.email },
          data: { pendingEmail: null },
        });
        return errorResponse(c, "That email address is already in use by another account.", 409);
      }
      throw error;
    }

    inBackground(() => sendEmailChangedNotice({ name: user.name, email: oldEmail }));
    await recordAudit(c, {
      userId: user.id,
      action: "EMAIL_CHANGED",
      entity: "User",
      entityId: user.id,
      details: { previousEmail: oldEmail, email: consumed.email },
    });
    return successResponse(c, null, {
      message: "Email changed. Please sign in again with the new address.",
    });
  })
  .openapi(resendRoute, async (c) => {
    const { email } = c.req.valid("json");

    inBackground(async () => {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || user.deletedAt || user.isBlocked) return;

      // A pending email change has its own link and target address; resend that one instead of
      // sending a current-address verification that would leave the change stuck.
      if (user.pendingEmail) {
        if (!(await mayEmail("change", user.pendingEmail))) return;
        await sendEmailChangeVerification(user, user.pendingEmail);
        await recordAudit(c, {
          userId: user.id,
          action: "EMAIL_CHANGE_VERIFICATION_RESENT",
          entity: "User",
          entityId: user.id,
        });
        return;
      }

      if (user.emailVerifiedAt) return;
      if (!(await mayEmail("verify", email))) return;
      await sendVerificationEmail(user);
      await recordAudit(c, {
        userId: user.id,
        action: "VERIFICATION_EMAIL_RESENT",
        entity: "User",
        entityId: user.id,
      });
    });

    return successResponse(c, null, {
      message: "If the account exists and is not verified, a new link has been sent.",
      status: 202,
    });
  });

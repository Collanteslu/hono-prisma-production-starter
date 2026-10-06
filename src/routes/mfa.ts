/**
 * @file mfa.ts
 * @description Two-factor authentication (TOTP) management, mounted under /api/auth/mfa.
 * Enrolling needs the password, so a stolen access token cannot attach an attacker's authenticator.
 */

import { createRoute, z } from "@hono/zod-openapi";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { recordAudit } from "../lib/audit.js";
import { createRouter, errorResponses, jsonBody, jsonResponse, secured } from "../lib/openapi.js";
import { errorResponse, successResponse } from "../lib/response.js";
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from "../lib/totp.js";
import { authMiddleware, requireAdmin } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rateLimit.js";
import {
  idParamSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaSetupSchema,
} from "../schemas/index.js";
import { successSchema } from "../schemas/responses.js";
import { verifySecondFactor } from "../services/mfa.js";
import { userSessionRevocationOps } from "../services/sessions.js";
import { comparePassword } from "../utils/password.js";

const router = createRouter();

router.use("/mfa/*", authMiddleware);
router.use("/mfa/*", rateLimiter("mfa", 60_000, env.MFA_RATE_LIMIT_MAX));

const authErrors = {
  401: "Token ausente, inválido o sesión revocada",
  429: "Rate limit excedido",
} as const;

const setupRoute = createRoute({
  method: "post",
  path: "/mfa/setup",
  tags: ["MFA"],
  summary: "Iniciar el alta de 2FA (TOTP)",
  description:
    "Genera un secreto nuevo (cifrado en base de datos) y devuelve el `secret` y la URI `otpauth://` para mostrarla como QR. El 2FA no se activa hasta confirmar con `POST /mfa/enable`.",
  security: secured,
  request: jsonBody(mfaSetupSchema),
  responses: {
    200: jsonResponse(
      successSchema(z.object({ secret: z.string(), otpauthUrl: z.string() })),
      "Secreto generado",
    ),
    ...errorResponses({
      400: "Error de validación",
      ...authErrors,
      403: "Contraseña incorrecta, o cuenta suspendida",
      409: "El 2FA ya está activo",
    }),
  },
});

const enableRoute = createRoute({
  method: "post",
  path: "/mfa/enable",
  tags: ["MFA"],
  summary: "Confirmar y activar el 2FA",
  description:
    "Verifica el primer código de la app, activa el 2FA, cierra el resto de sesiones y devuelve 10 códigos de recuperación (se muestran una sola vez).",
  security: secured,
  request: jsonBody(mfaEnableSchema),
  responses: {
    200: jsonResponse(
      successSchema(z.object({ recoveryCodes: z.array(z.string()) })),
      "2FA activado",
    ),
    ...errorResponses({
      400: "Código inválido",
      ...authErrors,
      403: "Cuenta suspendida",
      409: "No hay un alta pendiente o ya está activo",
    }),
  },
});

const disableRoute = createRoute({
  method: "post",
  path: "/mfa/disable",
  tags: ["MFA"],
  summary: "Desactivar el 2FA",
  description: "Exige la contraseña y un código TOTP o un código de recuperación.",
  security: secured,
  request: jsonBody(mfaDisableSchema),
  responses: {
    200: jsonResponse(successSchema(z.null()), "2FA desactivado"),
    ...errorResponses({
      400: "Error de validación",
      ...authErrors,
      403: "Contraseña o código incorrectos, o cuenta suspendida",
      409: "El 2FA no está activo",
    }),
  },
});

/** Loads the caller with the secrets the MFA flows need */
function loadUser(id: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id },
    omit: { password: false, totpSecret: false, totpLastStep: false },
  });
}

export const mfaRoutes = router
  .openapi(setupRoute, async (c) => {
    const { currentPassword } = c.req.valid("json");
    const user = await loadUser(c.get("user").userId);

    if (!(await comparePassword(currentPassword, user.password))) {
      return errorResponse(c, "Current password is incorrect.", 403);
    }
    if (user.totpEnabledAt)
      return errorResponse(c, "Two-factor authentication is already enabled.", 409);

    const secret = generateTotpSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: encryptSecret(secret), totpLastStep: null },
    });
    await recordAudit(c, {
      userId: user.id,
      action: "MFA_SETUP",
      entity: "User",
      entityId: user.id,
    });

    return successResponse(c, { secret, otpauthUrl: otpauthUrl(secret, user.email) });
  })
  .openapi(enableRoute, async (c) => {
    const { code } = c.req.valid("json");
    const current = c.get("user");
    const user = await loadUser(current.userId);

    if (user.totpEnabledAt || !user.totpSecret) {
      return errorResponse(c, "There is no pending two-factor setup. Call /mfa/setup first.", 409);
    }
    const step = verifyTotp(decryptSecret(user.totpSecret), code, null);
    if (step === null) return errorResponse(c, "Invalid two-factor code.", 400);

    const recoveryCodes = generateRecoveryCodes();
    const enabled = await prisma.$transaction(async (tx) => {
      // Conditional claim: of two concurrent confirmations of the same pending setup only one wins,
      // so the recovery codes it returns are the ones stored
      const claimed = await tx.user.updateMany({
        where: { id: user.id, totpEnabledAt: null, totpSecret: user.totpSecret },
        data: { totpEnabledAt: new Date(), totpLastStep: step },
      });
      if (claimed.count !== 1) return false;

      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.recoveryCode.createMany({
        data: recoveryCodes.map((rc) => ({ userId: user.id, codeHash: hashRecoveryCode(rc) })),
      });
      // Any other device must sign in again, now with the second factor
      await tx.session.updateMany({
        where: { userId: user.id, isActive: true, id: { not: current.sessionId } },
        data: { isActive: false },
      });
      await tx.refreshToken.deleteMany({
        where: {
          userId: user.id,
          OR: [{ sessionId: null }, { sessionId: { not: current.sessionId } }],
        },
      });
      return true;
    });
    if (!enabled) {
      return errorResponse(c, "There is no pending two-factor setup. Call /mfa/setup first.", 409);
    }

    await recordAudit(c, {
      userId: user.id,
      action: "MFA_ENABLED",
      entity: "User",
      entityId: user.id,
    });
    return successResponse(
      c,
      { recoveryCodes },
      { message: "Two-factor authentication enabled. Store the recovery codes safely." },
    );
  })
  .openapi(disableRoute, async (c) => {
    const { currentPassword, code, recoveryCode } = c.req.valid("json");
    const user = await loadUser(c.get("user").userId);

    if (!user.totpEnabledAt)
      return errorResponse(c, "Two-factor authentication is not enabled.", 409);
    if (!(await comparePassword(currentPassword, user.password))) {
      return errorResponse(c, "Current password or code is incorrect.", 403);
    }
    if (!(await verifySecondFactor(user, { code, recoveryCode }))) {
      return errorResponse(c, "Current password or code is incorrect.", 403);
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null },
      }),
      prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
    ]);

    await recordAudit(c, {
      userId: user.id,
      action: "MFA_DISABLED",
      entity: "User",
      entityId: user.id,
    });
    return successResponse(c, null, { message: "Two-factor authentication disabled." });
  });

// --- Admin reset, for users who lost their device -------------------------------------------
// Mounted under /api/users (where the auth middleware applies) and, like the rest of this file,
// only when AUTH_MODE=full.

const resetMfaRoute = createRoute({
  method: "delete",
  path: "/{id}/mfa",
  tags: ["Users"],
  summary: "Desactivar el 2FA de un usuario (Solo Admin)",
  description:
    "Para quien perdió su dispositivo y sus códigos de recuperación. Borra el secreto y los códigos, y cierra todas las sesiones del usuario.",
  security: secured,
  middleware: [requireAdmin] as const,
  request: { params: idParamSchema },
  responses: {
    200: jsonResponse(successSchema(z.null()), "2FA desactivado"),
    ...errorResponses({
      401: "Token ausente, inválido o sesión revocada",
      403: "Requiere rol administrador, o el usuario es uno mismo (usa `POST /api/auth/mfa/disable`)",
      404: "Usuario no encontrado",
      409: "El usuario no tiene 2FA",
    }),
  },
});

/** DELETE /api/users/:id/mfa */
export const userMfaRoutes = createRouter().openapi(resetMfaRoute, async (c) => {
  const { id } = c.req.valid("param");
  const currentUser = c.get("user");

  // Your own 2FA goes through /mfa/disable, which asks for the password and a code: an admin's
  // stolen access token alone must not be enough to strip the admin's second factor
  if (id === currentUser.userId) {
    return errorResponse(
      c,
      "Use POST /api/auth/mfa/disable to turn off your own two-factor authentication.",
      403,
    );
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || target.deletedAt) return errorResponse(c, `User with ID '${id}' not found.`, 404);
  if (!target.totpEnabledAt)
    return errorResponse(c, "The user has no two-factor authentication.", 409);

  await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null },
    }),
    prisma.recoveryCode.deleteMany({ where: { userId: id } }),
    ...userSessionRevocationOps(id),
  ]);

  await recordAudit(c, {
    userId: currentUser.userId,
    action: "MFA_RESET",
    entity: "User",
    entityId: id,
  });
  return successResponse(c, null, {
    message: "Two-factor authentication removed and sessions revoked.",
  });
});

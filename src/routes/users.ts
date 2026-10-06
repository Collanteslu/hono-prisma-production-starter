/**
 * @file users.ts
 * @description User account management routes including CRUD operations, pagination,
 * real-time account blocking, and bulk session revocation.
 * Password hashes never leave the database layer (omitted globally in the Prisma client).
 */

import { createRoute, z } from "@hono/zod-openapi";
import { env, features } from "../config/env.js";
import { prisma } from "../db.js";
import type { UserWhereInput } from "../generated/client/models.js";
import { recordAudit } from "../lib/audit.js";
import { createRouter, errorResponses, jsonBody, jsonResponse, secured } from "../lib/openapi.js";
import { parseFilters, parseSorting } from "../lib/query.js";
import { parseIncludes } from "../lib/relations.js";
import { buildPagination, errorResponse, successResponse } from "../lib/response.js";
import { requireAdmin } from "../middleware/auth.js";
import { passwordConfirmKey, passwordConfirmLockout } from "../middleware/rateLimit.js";
import {
  blockUserSchema,
  changeRoleSchema,
  createUserSchema,
  detailQuerySchema,
  idParamSchema,
  permanentQuerySchema,
  updateUserSchema,
  userQuerySchema,
} from "../schemas/index.js";
import { successSchema, userSchema } from "../schemas/responses.js";
import {
  inBackground,
  sendEmailChangedNotice,
  sendVerificationEmail,
} from "../services/accountMail.js";
import { deletePendingAuthTokensOp } from "../services/authTokens.js";
import { revokeUserSessions, userSessionRevocationOps } from "../services/sessions.js";
import { comparePassword, hashPassword } from "../utils/password.js";

const router = createRouter();

const authErrors = { 401: "Token ausente, inválido o sesión revocada" } as const;
const adminErrors = { ...authErrors, 403: "Requiere rol administrador" } as const;

// Soft-deleted tasks are left out of `?include=tasks` on purpose: the task list hides them the same
// way unless the caller explicitly asks for them (AGENTS.md rule 6). The relation stays unbounded.
const USER_INCLUDES = {
  tasks: { where: { deletedAt: null } },
  sessions: true,
} as const;

/**
 * Returns true when the given user is the only remaining active administrator.
 * Used to prevent locking everyone out of the admin API.
 */
async function isLastActiveAdmin(
  db: Pick<typeof prisma, "user">,
  user: { id: string; role: string },
) {
  if (user.role !== "admin") return false;
  const otherActiveAdmins = await db.user.count({
    where: { role: "admin", isBlocked: false, deletedAt: null, id: { not: user.id } },
  });
  return otherActiveAdmins === 0;
}

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Users"],
  summary: "Listar usuarios (Solo Admin)",
  description:
    "Lista paginada con búsqueda, orden y filtros dinámicos tipados `filter[campo]` sobre `name`, `email`, `role`, `isBlocked` y `createdAt`. Los usuarios eliminados solo aparecen con `includeDeleted=true`.",
  security: secured,
  middleware: [requireAdmin] as const,
  request: { query: userQuerySchema },
  responses: {
    200: jsonResponse(successSchema(z.array(userSchema)), "Lista paginada de usuarios"),
    ...errorResponses({ 400: "Parámetros o filtros inválidos", ...adminErrors }),
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Users"],
  summary: "Obtener usuario",
  description: "Perfil de un usuario. Solo Admin o el propio usuario.",
  security: secured,
  request: { params: idParamSchema, query: detailQuerySchema },
  responses: {
    200: jsonResponse(successSchema(userSchema), "Usuario"),
    ...errorResponses({
      400: "Parámetros de consulta inválidos",
      ...adminErrors,
      404: "Usuario no encontrado",
    }),
  },
});

const createUserRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Users"],
  summary: "Crear usuario (Solo Admin)",
  description:
    "Permite asignar cualquier rol. El registro público está en `POST /api/auth/register`.",
  security: secured,
  middleware: [requireAdmin] as const,
  request: jsonBody(createUserSchema),
  responses: {
    201: jsonResponse(successSchema(userSchema), "Usuario creado"),
    ...errorResponses({ 400: "Error de validación", ...adminErrors, 409: "Email duplicado" }),
  },
});

const blockRoute = createRoute({
  method: "patch",
  path: "/{id}/block",
  tags: ["Users"],
  summary: "Suspender o reactivar usuario (Solo Admin)",
  description:
    "Al suspender, todas las sesiones y refresh tokens del usuario se revocan de inmediato. Una cuenta eliminada no puede reactivarse.",
  security: secured,
  middleware: [requireAdmin] as const,
  request: { params: idParamSchema, ...jsonBody(blockUserSchema) },
  responses: {
    200: jsonResponse(successSchema(userSchema), "Estado actualizado"),
    ...errorResponses({
      400: "Error de validación o intento de suspenderse a uno mismo",
      ...adminErrors,
      404: "Usuario no encontrado",
      409: "Una cuenta eliminada no puede reactivarse",
    }),
  },
});

const roleRoute = createRoute({
  method: "patch",
  path: "/{id}/role",
  tags: ["Users"],
  summary: "Cambiar el rol de un usuario (Solo Admin)",
  description:
    "Asciende a admin o degrada a usuario. Un admin no puede cambiar su propio rol y nunca puede quedarse el sistema sin un administrador activo. El rol se lee de la base de datos en cada petición, por lo que el cambio es inmediato.",
  security: secured,
  middleware: [requireAdmin] as const,
  request: { params: idParamSchema, ...jsonBody(changeRoleSchema) },
  responses: {
    200: jsonResponse(successSchema(userSchema), "Rol actualizado"),
    ...errorResponses({
      400: "Error de validación o intento de cambiar el propio rol",
      ...adminErrors,
      404: "Usuario no encontrado",
      409: "Es el último administrador activo",
    }),
  },
});

const revokeSessionsRoute = createRoute({
  method: "post",
  path: "/{id}/revoke-sessions",
  tags: ["Users"],
  summary: "Revocar todas las sesiones de un usuario",
  description: "Cierra todas las sesiones activas del usuario objetivo. Solo el dueño o Admin.",
  security: secured,
  request: { params: idParamSchema },
  responses: {
    200: jsonResponse(successSchema(z.null()), "Sesiones revocadas"),
    ...errorResponses({ ...adminErrors }),
  },
});

const updateRoute = createRoute({
  method: "put",
  path: "/{id}",
  tags: ["Users"],
  summary: "Actualizar usuario",
  description:
    "Actualiza nombre, email o contraseña. Solo Admin o el propio usuario. Cambiar la contraseña revoca el resto de sesiones de la cuenta.",
  security: secured,
  request: { params: idParamSchema, ...jsonBody(updateUserSchema) },
  responses: {
    200: jsonResponse(successSchema(userSchema), "Perfil actualizado"),
    ...errorResponses({
      400: "Error de validación",
      ...adminErrors,
      404: "Usuario no encontrado",
      409: "Email en uso",
      429: "Demasiadas confirmaciones de contraseña incorrectas",
    }),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Users"],
  summary: "Eliminar usuario (soft delete por defecto)",
  description:
    "Soft delete revocando todas las sesiones, o borrado físico en cascada con `?permanent=true`. Solo Admin o el propio usuario. El último administrador activo no puede eliminarse.",
  security: secured,
  request: { params: idParamSchema, query: permanentQuerySchema },
  responses: {
    200: jsonResponse(successSchema(userSchema), "Usuario eliminado"),
    ...errorResponses({
      400: "Parámetros de consulta inválidos",
      ...adminErrors,
      404: "Usuario no encontrado",
      409: "No se puede eliminar al último administrador activo",
    }),
  },
});

export const userRoutes = router
  /**
   * GET /api/users
   * Returns a paginated list of users with search and filtering capabilities (Admin only).
   */
  .openapi(listRoute, async (c) => {
    const { page, limit, search, role, isBlocked, sortBy, order, sort, includeDeleted } =
      c.req.valid("query");
    const skip = (page - 1) * limit;

    // Apply generic filter[...] parameters
    const where: UserWhereInput = parseFilters(c.req.query(), {
      allowedFields: {
        name: "string",
        email: "string",
        role: "string",
        isBlocked: "boolean",
        createdAt: "date",
      },
    });

    // Soft delete filter: Exclude soft-deleted users unless requested
    if (includeDeleted !== "true") {
      where.deletedAt = null;
    }

    if (role) {
      where.role = role;
    }

    if (isBlocked !== undefined) {
      where.isBlocked = isBlocked === "true";
    }

    if (search) {
      where.OR = [{ name: { contains: search } }, { email: { contains: search } }];
    }

    // Apply sorting (prioritize ?sort=-field if provided, fallback to sortBy & order)
    const orderBy = sort
      ? parseSorting(sort, { allowedFields: ["createdAt", "name", "email", "role"] })
      : { [sortBy]: order };

    const include = parseIncludes(c.req.query("include"), USER_INCLUDES);

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include,
      }),
    ]);

    return successResponse(c, users, { pagination: buildPagination(total, page, limit) });
  })
  /**
   * GET /api/users/:id
   * Fetches user profile details by ID (Admin or the user themselves).
   */
  .openapi(getRoute, async (c) => {
    const { id } = c.req.valid("param");
    const currentUser = c.get("user");

    if (currentUser.role !== "admin" && currentUser.userId !== id) {
      return errorResponse(
        c,
        "Forbidden: You do not have permission to view this user profile.",
        403,
      );
    }

    const user = await prisma.user.findUnique({
      where: { id },
      include: parseIncludes(c.req.query("include"), USER_INCLUDES),
    });

    // Soft-deleted accounts are hidden by default (the list does the same); the documented
    // includeDeleted=true parameter is the only way to read one back
    if (!user || (user.deletedAt && c.req.valid("query").includeDeleted !== "true")) {
      return errorResponse(c, `User with ID '${id}' not found.`, 404);
    }

    return successResponse(c, user);
  })
  /**
   * POST /api/users
   * Creates a new user with bcrypt-hashed credentials (Admin only).
   * Public self-service sign-up is available at POST /api/auth/register.
   */
  .openapi(createUserRoute, async (c) => {
    const { name, email, password, role } = c.req.valid("json");

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return errorResponse(c, `Email '${email}' is already registered.`, 409);
    }

    const newUser = await prisma.user.create({
      data: { name, email, password: await hashPassword(password), role },
    });

    await recordAudit(c, {
      userId: c.get("user").userId,
      action: "CREATE",
      entity: "User",
      entityId: newUser.id,
      details: { email, role },
    });

    return successResponse(c, newUser, {
      status: 201,
      message: "User created successfully with hashed credentials.",
    });
  })
  /**
   * PATCH /api/users/:id/block
   * Suspends or reactivates a user account (Admin only).
   * If suspended, all active sessions and refresh tokens are terminated immediately.
   */
  .openapi(blockRoute, async (c) => {
    const { id } = c.req.valid("param");
    const currentUser = c.get("user");

    if (currentUser.userId === id) {
      return errorResponse(
        c,
        "Invalid action: Administrators cannot suspend their own account.",
        400,
      );
    }

    const targetUser = await prisma.user.findUnique({ where: { id } });

    if (!targetUser) {
      return errorResponse(c, `User with ID '${id}' not found.`, 404);
    }

    const { isBlocked, reason } = c.req.valid("json");

    if (!isBlocked && targetUser.deletedAt) {
      return errorResponse(c, "Invalid action: Deleted accounts cannot be reactivated.", 409);
    }

    // Block + session revocation are atomic, and the last-admin check shares the transaction so two
    // admins suspending each other at the same time cannot both succeed.
    const blocked = await prisma.$transaction(async (tx) => {
      if (isBlocked && (await isLastActiveAdmin(tx, targetUser))) return null;

      const user = await tx.user.update({
        where: { id },
        data: {
          isBlocked,
          blockedReason: isBlocked ? reason || "Suspended by administrator" : null,
        },
      });
      if (!isBlocked) return { user, revokedSessionsCount: 0 };

      const revoked = await tx.session.updateMany({
        where: { userId: id, isActive: true },
        data: { isActive: false },
      });
      await tx.refreshToken.deleteMany({ where: { userId: id } });
      return { user, revokedSessionsCount: revoked.count };
    });

    if (!blocked) {
      return errorResponse(c, "Invalid action: Cannot suspend the last active administrator.", 409);
    }
    const { user: updatedUser, revokedSessionsCount } = blocked;

    await recordAudit(c, {
      userId: currentUser.userId,
      action: isBlocked ? "BLOCK" : "UNBLOCK",
      entity: "User",
      entityId: id,
      details: { reason: updatedUser.blockedReason, revokedSessionsCount },
    });

    return successResponse(c, updatedUser, {
      message: isBlocked
        ? `User '${updatedUser.name}' has been suspended and ${revokedSessionsCount} active session(s) terminated.`
        : `User '${updatedUser.name}' has been reactivated successfully.`,
    });
  })
  /**
   * PATCH /api/users/:id/role
   * Promotes or demotes a user (Admin only). The last active administrator can never be demoted.
   */
  .openapi(roleRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { role } = c.req.valid("json");
    const currentUser = c.get("user");

    if (currentUser.userId === id) {
      return errorResponse(c, "Invalid action: Administrators cannot change their own role.", 400);
    }

    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser || targetUser.deletedAt) {
      return errorResponse(c, `User with ID '${id}' not found.`, 404);
    }

    const result = await prisma.$transaction(async (tx) => {
      if (role !== "admin" && (await isLastActiveAdmin(tx, targetUser))) return null;
      return tx.user.update({ where: { id }, data: { role } });
    });

    if (!result) {
      return errorResponse(c, "Invalid action: Cannot demote the last active administrator.", 409);
    }

    await recordAudit(c, {
      userId: currentUser.userId,
      action: "ROLE_CHANGE",
      entity: "User",
      entityId: id,
      details: { from: targetUser.role, to: role },
    });

    return successResponse(c, result, {
      message: `User '${result.name}' is now ${role === "admin" ? "an administrator" : "a standard user"}.`,
    });
  })
  /**
   * POST /api/users/:id/revoke-sessions
   * Revokes all active sessions for a target user (User self-service or Admin).
   */
  .openapi(revokeSessionsRoute, async (c) => {
    const { id } = c.req.valid("param");
    const currentUser = c.get("user");

    if (currentUser.userId !== id && currentUser.role !== "admin") {
      return errorResponse(
        c,
        "Access denied: You can only revoke your own sessions unless you are an administrator.",
        403,
      );
    }

    const revokedCount = await revokeUserSessions(id);

    await recordAudit(c, {
      userId: currentUser.userId,
      action: "REVOKE_ALL_SESSIONS",
      entity: "User",
      entityId: id,
      details: { revokedCount },
    });

    return successResponse(c, null, {
      message: `Revoked ${revokedCount} active session(s) for user.`,
    });
  })
  /**
   * PUT /api/users/:id
   * Updates user profile information (Admin or the user themselves).
   * Changing the password revokes every other session of the account.
   */
  .openapi(updateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const currentUser = c.get("user");

    if (currentUser.role !== "admin" && currentUser.userId !== id) {
      return errorResponse(
        c,
        "Forbidden: You do not have permission to modify another user's profile.",
        403,
      );
    }

    const changes = c.req.valid("json");
    const { name, email, password, currentPassword } = changes;

    const existingUser = await prisma.user.findUnique({ where: { id } });

    if (!existingUser || existingUser.deletedAt) {
      return errorResponse(c, `User with ID '${id}' not found.`, 404);
    }

    // A stolen access token must not be enough to take over the account: changing your own
    // password or email (the password-reset address) requires the current password. Admins
    // modifying someone else are exempt.
    const emailChanging = Boolean(email && email !== existingUser.email);
    if ((password || emailChanging) && currentUser.userId === id) {
      const retryAfter = await passwordConfirmLockout.retryAfterSeconds(passwordConfirmKey(id));
      if (retryAfter > 0) {
        return errorResponse(
          c,
          `Too many incorrect password confirmations. Try again in ${retryAfter} seconds.`,
          429,
        );
      }
      const stored = await prisma.user.findUnique({
        where: { id },
        omit: { password: false },
      });
      const valid =
        !!currentPassword && !!stored && (await comparePassword(currentPassword, stored.password));
      if (!valid) {
        await passwordConfirmLockout.recordFailure(passwordConfirmKey(id));
        return errorResponse(c, "Current password is missing or incorrect.", 403);
      }
      await passwordConfirmLockout.reset(passwordConfirmKey(id));
    }

    if (email && email !== existingUser.email) {
      const emailTaken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (emailTaken) {
        return errorResponse(c, `Email '${email}' is already in use by another account.`, 409);
      }
    }

    const updateOp = prisma.user.update({
      where: { id },
      data: {
        ...(name && { name }),
        // A new address starts unverified
        ...(emailChanging && { email, emailVerifiedAt: null }),
        ...(password && { password: await hashPassword(password) }),
      },
    });

    // A password change invalidates every other session (keep the caller's own session alive).
    // A password or email change also deletes every pending emailed token (reset / verification
    // links sent before it must not survive it). All of it runs in one transaction.
    let updatedUser: Awaited<typeof updateOp>;
    let revokedSessionsCount = 0;
    if (password) {
      const [user, , revoked] = await prisma.$transaction([
        updateOp,
        deletePendingAuthTokensOp(id),
        ...userSessionRevocationOps(id, {
          exceptSessionId: currentUser.userId === id ? currentUser.sessionId : undefined,
        }),
      ]);
      updatedUser = user;
      revokedSessionsCount = revoked.count;
    } else if (emailChanging) {
      [updatedUser] = await prisma.$transaction([updateOp, deletePendingAuthTokensOp(id)]);
    } else {
      updatedUser = await updateOp;
    }

    if (emailChanging && features.accountSecurity && env.MAIL_TRANSPORT !== "none") {
      inBackground(() => sendVerificationEmail(updatedUser));
      inBackground(() =>
        sendEmailChangedNotice({ name: updatedUser.name, email: existingUser.email }),
      );
    }

    await recordAudit(c, {
      userId: currentUser.userId,
      action: password ? "PASSWORD_CHANGE" : "UPDATE",
      entity: "User",
      entityId: id,
      details: { updatedFields: Object.keys(changes), revokedSessionsCount },
    });

    return successResponse(c, updatedUser, {
      message: "User profile updated successfully.",
    });
  })
  /**
   * DELETE /api/users/:id
   * Soft deletes a user account (revoking all sessions), or permanently deletes it with
   * cascading deletion across tasks and sessions when ?permanent=true.
   * Security: Only admins or the account owner can delete an account, and the last
   * active administrator can never be deleted.
   */
  .openapi(deleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const isPermanent = c.req.valid("query").permanent === "true";
    const currentUser = c.get("user");

    if (currentUser.role !== "admin" && currentUser.userId !== id) {
      return errorResponse(
        c,
        "Forbidden: You do not have permission to delete another user's account.",
        403,
      );
    }

    const existingUser = await prisma.user.findUnique({ where: { id } });

    if (!existingUser || (existingUser.deletedAt && !isPermanent)) {
      return errorResponse(c, `User with ID '${id}' not found.`, 404);
    }

    // The "last admin" check and the delete/soft-delete run in one transaction, so two concurrent
    // removals of the last two admins cannot both pass the check.
    const outcome = await prisma.$transaction(async (tx) => {
      if (!existingUser.deletedAt && (await isLastActiveAdmin(tx, existingUser))) {
        return { lastAdmin: true as const };
      }

      if (isPermanent) {
        const tasksCount = await tx.task.count({ where: { userId: id } });
        await tx.user.delete({ where: { id } });
        return { lastAdmin: false as const, tasksCount };
      }

      const softDeletedUser = await tx.user.update({
        where: { id },
        data: { deletedAt: new Date(), isBlocked: true, blockedReason: "Account deleted" },
      });
      await tx.session.updateMany({
        where: { userId: id, isActive: true },
        data: { isActive: false },
      });
      await tx.refreshToken.deleteMany({ where: { userId: id } });
      return { lastAdmin: false as const, softDeletedUser };
    });

    if (outcome.lastAdmin) {
      return errorResponse(c, "Invalid action: Cannot delete the last active administrator.", 409);
    }

    if ("tasksCount" in outcome) {
      await recordAudit(c, {
        userId: currentUser.userId === id ? null : currentUser.userId,
        action: "DELETE_PERMANENT",
        entity: "User",
        entityId: id,
        details: { email: existingUser.email },
      });

      return successResponse(c, existingUser, {
        message: `User '${existingUser.name}' and ${outcome.tasksCount} associated task(s) permanently deleted.`,
      });
    }

    const { softDeletedUser } = outcome;

    await recordAudit(c, {
      userId: currentUser.userId,
      action: "SOFT_DELETE",
      entity: "User",
      entityId: id,
    });

    return successResponse(c, softDeletedUser, {
      message: `User '${existingUser.name}' soft-deleted and all sessions revoked.`,
    });
  });

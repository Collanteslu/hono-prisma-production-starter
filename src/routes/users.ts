/**
 * @file users.ts
 * @description User account management routes including CRUD operations, pagination,
 * real-time account blocking, and bulk session revocation.
 * Password hashes never leave the database layer (omitted globally in the Prisma client).
 */

import { Hono } from "hono";
import { prisma } from "../db.js";
import type { UserWhereInput } from "../generated/client/models.js";
import { recordAudit } from "../lib/audit.js";
import { parseFilters, parseSorting } from "../lib/query.js";
import { parseIncludes } from "../lib/relations.js";
import { buildPagination, errorResponse, successResponse } from "../lib/response.js";
import { validate } from "../lib/validator.js";
import { requireAdmin } from "../middleware/auth.js";
import {
  blockUserSchema,
  createUserSchema,
  updateUserSchema,
  userQuerySchema,
} from "../schemas/index.js";
import { revokeUserSessions, userSessionRevocationOps } from "../services/sessions.js";
import type { AppEnv } from "../types/index.js";
import { hashPassword } from "../utils/password.js";

export const userRoutes = new Hono<AppEnv>();

const USER_INCLUDES = {
  tasks: true,
  sessions: true,
} as const;

/**
 * Returns true when the given user is the only remaining active administrator.
 * Used to prevent locking everyone out of the admin API.
 */
async function isLastActiveAdmin(user: { id: string; role: string }) {
  if (user.role !== "admin") return false;
  const otherActiveAdmins = await prisma.user.count({
    where: { role: "admin", isBlocked: false, deletedAt: null, id: { not: user.id } },
  });
  return otherActiveAdmins === 0;
}

/**
 * GET /api/users
 * Returns a paginated list of users with search and filtering capabilities (Admin only).
 */
userRoutes.get(
  "/",
  requireAdmin,
  validate("query", userQuerySchema, "Invalid query parameters for users list"),
  async (c) => {
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
  },
);

/**
 * GET /api/users/:id
 * Fetches user profile details by ID (Admin or the user themselves).
 */
userRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
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

  if (!user) {
    return errorResponse(c, `User with ID '${id}' not found.`, 404);
  }

  return successResponse(c, user);
});

/**
 * POST /api/users
 * Creates a new user with bcrypt-hashed credentials (Admin only).
 * Public self-service sign-up is available at POST /api/auth/register.
 */
userRoutes.post(
  "/",
  requireAdmin,
  validate("json", createUserSchema, "Validation error when creating user"),
  async (c) => {
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
  },
);

/**
 * PATCH /api/users/:id/block
 * Suspends or reactivates a user account (Admin only).
 * If suspended, all active sessions and refresh tokens are terminated immediately.
 */
userRoutes.patch(
  "/:id/block",
  requireAdmin,
  validate("json", blockUserSchema, "Validation error in block user payload"),
  async (c) => {
    const id = c.req.param("id");
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

    const update = prisma.user.update({
      where: { id },
      data: {
        isBlocked,
        blockedReason: isBlocked ? reason || "Suspended by administrator" : null,
      },
    });

    // Terminate all active sessions immediately upon suspension (atomically with the block)
    const [updatedUser, revokedSessions] = isBlocked
      ? await prisma.$transaction([update, ...userSessionRevocationOps(id)])
      : [await update, { count: 0 }];
    const revokedSessionsCount = revokedSessions.count;

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
  },
);

/**
 * POST /api/users/:id/revoke-sessions
 * Revokes all active sessions for a target user (User self-service or Admin).
 */
userRoutes.post("/:id/revoke-sessions", async (c) => {
  const id = c.req.param("id");
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
});

/**
 * PUT /api/users/:id
 * Updates user profile information (Admin or the user themselves).
 * Changing the password revokes every other session of the account.
 */
userRoutes.put(
  "/:id",
  validate("json", updateUserSchema, "Validation error when updating user"),
  async (c) => {
    const id = c.req.param("id");
    const currentUser = c.get("user");

    if (currentUser.role !== "admin" && currentUser.userId !== id) {
      return errorResponse(
        c,
        "Forbidden: You do not have permission to modify another user's profile.",
        403,
      );
    }

    const existingUser = await prisma.user.findUnique({ where: { id } });

    if (!existingUser || existingUser.deletedAt) {
      return errorResponse(c, `User with ID '${id}' not found.`, 404);
    }

    const changes = c.req.valid("json");
    const { name, email, password } = changes;

    if (email && email !== existingUser.email) {
      const emailTaken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (emailTaken) {
        return errorResponse(c, `Email '${email}' is already in use by another account.`, 409);
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(email && { email }),
        ...(password && { password: await hashPassword(password) }),
      },
    });

    // A password change invalidates every other session (keep the caller's own session alive)
    const revokedSessionsCount = password
      ? await revokeUserSessions(id, {
          exceptSessionId: currentUser.userId === id ? currentUser.sessionId : undefined,
        })
      : 0;

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
  },
);

/**
 * DELETE /api/users/:id
 * Soft deletes a user account (revoking all sessions), or permanently deletes it with
 * cascading deletion across tasks and sessions when ?permanent=true.
 * Security: Only admins or the account owner can delete an account, and the last
 * active administrator can never be deleted.
 */
userRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const isPermanent = c.req.query("permanent") === "true";
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

  if (!existingUser.deletedAt && (await isLastActiveAdmin(existingUser))) {
    return errorResponse(c, "Invalid action: Cannot delete the last active administrator.", 409);
  }

  if (isPermanent) {
    const tasksCount = await prisma.task.count({ where: { userId: id } });

    await prisma.user.delete({ where: { id } });

    await recordAudit(c, {
      userId: currentUser.userId === id ? null : currentUser.userId,
      action: "DELETE_PERMANENT",
      entity: "User",
      entityId: id,
      details: { email: existingUser.email },
    });

    return successResponse(c, existingUser, {
      message: `User '${existingUser.name}' and ${tasksCount} associated task(s) permanently deleted.`,
    });
  }

  // Soft delete user and revoke all active sessions and refresh tokens
  const [softDeletedUser] = await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), isBlocked: true, blockedReason: "Account deleted" },
    }),
    ...userSessionRevocationOps(id),
  ]);

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

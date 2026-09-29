/**
 * @file users.ts
 * @description User account management routes including CRUD operations, pagination,
 * real-time account blocking, and bulk session revocation.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { prisma } from "../db.js";
import type { UserWhereInput } from "../generated/client/models.js";
import { successResponse } from "../lib/response.js";
import {
  blockUserSchema,
  createUserSchema,
  updateUserSchema,
  userQuerySchema,
} from "../schemas/index.js";
import type { AppEnv, PaginationMeta } from "../types/index.js";
import { hashPassword } from "../utils/password.js";

export const userRoutes = new Hono<AppEnv>();

/**
 * Sanitizes user entity by removing sensitive fields (password hash) before client serialization.
 */
function sanitizeUser(user: {
  id: string;
  name: string;
  email: string;
  role: string;
  isBlocked: boolean;
  blockedReason?: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isBlocked: user.isBlocked,
    blockedReason: user.blockedReason,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * GET /api/users
 * Returns a paginated list of users with search and filtering capabilities.
 */
userRoutes.get(
  "/",
  zValidator("query", userQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: "Invalid query parameters for users list",
          errors: result.error.flatten().fieldErrors,
        },
        400,
      );
    }
  }),
  async (c) => {
    const { page, limit, search, role, isBlocked, sortBy, order } = c.req.valid("query");
    const skip = (page - 1) * limit;

    const where: UserWhereInput = {};

    if (role) {
      where.role = role;
    }

    if (isBlocked !== undefined) {
      where.isBlocked = isBlocked === "true";
    }

    if (search) {
      where.OR = [{ name: { contains: search } }, { email: { contains: search } }];
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: order },
      }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;
    const pagination: PaginationMeta = {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };

    return successResponse(c, users.map(sanitizeUser), { pagination });
  },
);

/**
 * GET /api/users/:id
 * Fetches user profile details by ID.
 */
userRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user) {
    return c.json(
      {
        success: false,
        message: `User with ID '${id}' not found.`,
      },
      404,
    );
  }

  return successResponse(c, sanitizeUser(user));
});

/**
 * POST /api/users
 * Creates a new user with bcrypt-hashed credentials.
 */
userRoutes.post(
  "/",
  zValidator("json", createUserSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: "Validation error when creating user",
          errors: result.error.flatten().fieldErrors,
        },
        400,
      );
    }
  }),
  async (c) => {
    const { name, email, password, role } = c.req.valid("json");

    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existing) {
      return c.json(
        {
          success: false,
          message: `Email '${email}' is already registered.`,
        },
        409,
      );
    }

    const currentUser = c.get("user");
    const finalRole: "admin" | "user" =
      role === "admin" && currentUser?.role === "admin" ? "admin" : "user";

    const hashedPassword = await hashPassword(password);

    const newUser = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        role: finalRole,
      },
    });

    return c.json(
      {
        success: true,
        message: "User created successfully with hashed credentials.",
        data: sanitizeUser(newUser),
      },
      201,
    );
  },
);

/**
 * PATCH /api/users/:id/block
 * Suspends or reactivates a user account (Admin only).
 * If suspended, all active sessions and refresh tokens are terminated immediately.
 */
userRoutes.patch(
  "/:id/block",
  zValidator("json", blockUserSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: "Validation error in block user payload",
          errors: result.error.flatten().fieldErrors,
        },
        400,
      );
    }
  }),
  async (c) => {
    const id = c.req.param("id");
    const currentUser = c.get("user");

    if (currentUser.role !== "admin") {
      return c.json(
        {
          success: false,
          message: "Access denied: Only administrators can suspend or reactivate users.",
        },
        403,
      );
    }

    if (currentUser.userId === id) {
      return c.json(
        {
          success: false,
          message: "Invalid action: Administrators cannot suspend their own account.",
        },
        400,
      );
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!targetUser) {
      return c.json(
        {
          success: false,
          message: `User with ID '${id}' not found.`,
        },
        404,
      );
    }

    const { isBlocked, reason } = c.req.valid("json");

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        isBlocked,
        blockedReason: isBlocked ? reason || "Suspended by administrator" : null,
      },
    });

    // Terminate all active sessions immediately upon suspension
    let revokedSessionsCount = 0;
    if (isBlocked) {
      const res = await prisma.session.updateMany({
        where: { userId: id, isActive: true },
        data: { isActive: false },
      });
      revokedSessionsCount = res.count;

      await prisma.refreshToken.deleteMany({
        where: { userId: id },
      });
    }

    return c.json({
      success: true,
      message: isBlocked
        ? `User '${updatedUser.name}' has been suspended and ${revokedSessionsCount} active session(s) terminated.`
        : `User '${updatedUser.name}' has been reactivated successfully.`,
      data: sanitizeUser(updatedUser),
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
    return c.json(
      {
        success: false,
        message:
          "Access denied: You can only revoke your own sessions unless you are an administrator.",
      },
      403,
    );
  }

  const res = await prisma.session.updateMany({
    where: { userId: id, isActive: true },
    data: { isActive: false },
  });

  await prisma.refreshToken.deleteMany({
    where: { userId: id },
  });

  return c.json({
    success: true,
    message: `Revoked ${res.count} active session(s) for user.`,
  });
});

/**
 * PUT /api/users/:id
 * Updates user profile information.
 */
userRoutes.put(
  "/:id",
  zValidator("json", updateUserSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: "Validation error when updating user",
          errors: result.error.flatten().fieldErrors,
        },
        400,
      );
    }
  }),
  async (c) => {
    const id = c.req.param("id");

    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      return c.json(
        {
          success: false,
          message: `User with ID '${id}' not found.`,
        },
        404,
      );
    }

    const { name, email, password } = c.req.valid("json");

    if (email && email.toLowerCase() !== existingUser.email) {
      const emailTaken = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });
      if (emailTaken) {
        return c.json(
          {
            success: false,
            message: `Email '${email}' is already in use by another account.`,
          },
          409,
        );
      }
    }

    let hashedPasswordUpdate: string | undefined;
    if (password) {
      hashedPasswordUpdate = await hashPassword(password);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(email && { email: email.toLowerCase() }),
        ...(hashedPasswordUpdate && { password: hashedPasswordUpdate }),
      },
    });

    return c.json({
      success: true,
      message: "User profile updated successfully.",
      data: sanitizeUser(updatedUser),
    });
  },
);

/**
 * DELETE /api/users/:id
 * Deletes a user account with cascading deletion across tasks and sessions.
 */
userRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  const existingUser = await prisma.user.findUnique({
    where: { id },
  });

  if (!existingUser) {
    return c.json(
      {
        success: false,
        message: `User with ID '${id}' not found.`,
      },
      404,
    );
  }

  const tasksCount = await prisma.task.count({ where: { userId: id } });

  await prisma.user.delete({
    where: { id },
  });

  return c.json({
    success: true,
    message: `User '${existingUser.name}' and ${tasksCount} associated task(s) deleted successfully.`,
    data: sanitizeUser(existingUser),
  });
});

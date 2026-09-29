/**
 * @file tasks.ts
 * @description Task management CRUD routes with strict user ownership and pagination.
 *
 * Security Model:
 * Standard users can ONLY read, create, update, and delete tasks they own.
 * Any attempt to access a task belonging to another user results in HTTP 403 Forbidden.
 * Soft-deleted tasks are hidden (404) except when explicitly requested or restored.
 */

import type { Context } from "hono";
import { Hono } from "hono";
import { prisma } from "../db.js";
import type { TaskWhereInput } from "../generated/client/models.js";
import { recordAudit } from "../lib/audit.js";
import { parseFilters, parseSorting } from "../lib/query.js";
import { parseIncludes } from "../lib/relations.js";
import { buildPagination, errorResponse, successResponse } from "../lib/response.js";
import { validate } from "../lib/validator.js";
import { createTaskSchema, taskQuerySchema, updateTaskSchema } from "../schemas/index.js";
import type { AppEnv } from "../types/index.js";

export const taskRoutes = new Hono<AppEnv>();

const TASK_INCLUDES = {
  user: { select: { id: true, name: true, email: true, role: true } },
};

/**
 * Loads a task and enforces ownership. Returns either the task or an error response.
 */
async function findOwnedTask(
  c: Context<AppEnv>,
  id: string,
  options: { action: string; allowDeleted?: boolean },
) {
  const task = await prisma.task.findUnique({ where: { id } });

  if (!task || (task.deletedAt && !options.allowDeleted)) {
    return { error: errorResponse(c, `Task with ID '${id}' not found.`, 404) };
  }

  if (task.userId !== c.get("user").userId) {
    return {
      error: errorResponse(
        c,
        `Access denied: You do not have permission to ${options.action} this task.`,
        403,
      ),
    };
  }

  return { task };
}

/**
 * GET /api/tasks
 * Lists tasks belonging exclusively to the authenticated user with pagination and filters.
 */
taskRoutes.get(
  "/",
  validate("query", taskQuerySchema, "Invalid task query parameters"),
  async (c) => {
    const currentUser = c.get("user");
    const { page, limit, search, completed, sortBy, order, sort, includeDeleted } =
      c.req.valid("query");
    const skip = (page - 1) * limit;

    // Apply generic filter[...] parameters first so they can never override the ownership scope
    const where: TaskWhereInput = parseFilters(c.req.query(), {
      allowedFields: {
        title: "string",
        description: "string",
        completed: "boolean",
        createdAt: "date",
      },
    });

    // Strict ownership filter: Always scope to the token's authenticated userId
    where.userId = currentUser.userId;

    // Soft delete filter: By default, exclude soft-deleted tasks unless explicitly requested
    if (includeDeleted !== "true") {
      where.deletedAt = null;
    }

    if (completed !== undefined) {
      where.completed = completed === "true";
    }

    if (search) {
      where.OR = [{ title: { contains: search } }, { description: { contains: search } }];
    }

    // Apply sorting (prioritize ?sort=-field if provided, fallback to sortBy & order)
    const orderBy = sort
      ? parseSorting(sort, { allowedFields: ["createdAt", "title", "completed"] })
      : { [sortBy]: order };

    const include = parseIncludes(c.req.query("include"), TASK_INCLUDES);

    const [total, tasks] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include,
      }),
    ]);

    return successResponse(c, tasks, { pagination: buildPagination(total, page, limit) });
  },
);

/**
 * GET /api/tasks/:id
 * Retrieves a single task ensuring strict ownership validation.
 * Soft-deleted tasks are only returned with ?includeDeleted=true.
 */
taskRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const include = parseIncludes(c.req.query("include"), TASK_INCLUDES);

  const task = await prisma.task.findUnique({
    where: { id },
    include,
  });

  if (!task || (task.deletedAt && c.req.query("includeDeleted") !== "true")) {
    return errorResponse(c, `Task with ID '${id}' not found.`, 404);
  }

  // Ownership verification
  if (task.userId !== c.get("user").userId) {
    return errorResponse(c, "Access denied: You do not have permission to view this task.", 403);
  }

  return successResponse(c, task);
});

/**
 * POST /api/tasks
 * Creates a new task bound strictly to the authenticated user.
 */
taskRoutes.post(
  "/",
  validate("json", createTaskSchema, "Validation error when creating task"),
  async (c) => {
    const { title, description, completed } = c.req.valid("json");
    const currentUser = c.get("user");

    const newTask = await prisma.task.create({
      data: {
        userId: currentUser.userId, // Secure assignment from verified token
        title,
        description,
        completed,
      },
    });

    await recordAudit(c, {
      userId: currentUser.userId,
      action: "CREATE",
      entity: "Task",
      entityId: newTask.id,
      details: { title: newTask.title },
    });

    return successResponse(c, newTask, {
      status: 201,
      message: "Task created successfully.",
    });
  },
);

/**
 * PUT /api/tasks/:id
 * Updates task properties (title, description, completed) verifying ownership.
 */
taskRoutes.put(
  "/:id",
  validate("json", updateTaskSchema, "Validation error when updating task"),
  async (c) => {
    const id = c.req.param("id");
    const { error } = await findOwnedTask(c, id, { action: "edit" });
    if (error) return error;

    const changes = c.req.valid("json");
    const updatedTask = await prisma.task.update({
      where: { id },
      data: changes,
    });

    await recordAudit(c, {
      userId: c.get("user").userId,
      action: "UPDATE",
      entity: "Task",
      entityId: id,
      details: { changedFields: Object.keys(changes) },
    });

    return successResponse(c, updatedTask, { message: "Task updated successfully." });
  },
);

/**
 * POST /api/tasks/:id/restore
 * Restores a soft-deleted task.
 */
taskRoutes.post("/:id/restore", async (c) => {
  const id = c.req.param("id");
  const { task, error } = await findOwnedTask(c, id, { action: "restore", allowDeleted: true });
  if (error) return error;

  if (!task.deletedAt) {
    return errorResponse(c, "Task is not deleted.", 409);
  }

  const restored = await prisma.task.update({ where: { id }, data: { deletedAt: null } });

  await recordAudit(c, {
    userId: c.get("user").userId,
    action: "RESTORE",
    entity: "Task",
    entityId: id,
  });

  return successResponse(c, restored, { message: "Task restored successfully." });
});

/**
 * DELETE /api/tasks/:id
 * Soft deletes a task by setting deletedAt timestamp, or permanently deletes if ?permanent=true.
 */
taskRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const isPermanent = c.req.query("permanent") === "true";

  // Permanent deletion is also allowed on already soft-deleted tasks
  const { error } = await findOwnedTask(c, id, { action: "delete", allowDeleted: isPermanent });
  if (error) return error;

  const userId = c.get("user").userId;

  if (isPermanent) {
    await prisma.task.delete({
      where: { id },
    });

    await recordAudit(c, {
      userId,
      action: "DELETE_PERMANENT",
      entity: "Task",
      entityId: id,
    });

    return successResponse(
      c,
      { id, deletedPermanently: true },
      { message: "Task permanently deleted." },
    );
  }

  // Soft delete
  const softDeleted = await prisma.task.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await recordAudit(c, {
    userId,
    action: "SOFT_DELETE",
    entity: "Task",
    entityId: id,
  });

  return successResponse(c, softDeleted, { message: "Task soft-deleted successfully." });
});

/**
 * @file tasks.ts
 * @description Task management CRUD routes with strict user ownership and pagination.
 *
 * Security Model:
 * Standard users can ONLY read, create, update, and delete tasks they own.
 * A task belonging to another user is indistinguishable from a missing one (HTTP 404).
 * Soft-deleted tasks are hidden (404) except when explicitly requested or restored.
 */

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { prisma } from "../db.js";
import type { TaskWhereInput } from "../generated/client/models.js";
import { recordAudit } from "../lib/audit.js";
import { createRouter, errorResponses, jsonBody, jsonResponse, secured } from "../lib/openapi.js";
import { parseFilters, parseSorting } from "../lib/query.js";
import { parseIncludes } from "../lib/relations.js";
import { buildPagination, errorResponse, successResponse } from "../lib/response.js";
import {
  createTaskSchema,
  detailQuerySchema,
  idParamSchema,
  permanentQuerySchema,
  taskQuerySchema,
  updateTaskSchema,
} from "../schemas/index.js";
import { successSchema, taskSchema } from "../schemas/responses.js";
import type { AppEnv } from "../types/index.js";

const router = createRouter();

const TASK_INCLUDES = {
  user: { select: { id: true, name: true, email: true, role: true } },
};

const authErrors = { 401: "Token ausente, inválido o sesión revocada" } as const;

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

  // Someone else's task answers exactly like a missing one, so IDs cannot be probed for existence
  if (task.userId !== c.get("user").userId) {
    return { error: errorResponse(c, `Task with ID '${id}' not found.`, 404) };
  }

  return { task };
}

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Tasks"],
  summary: "Listar tareas del usuario",
  description:
    "Lista paginada de las tareas del usuario autenticado (un Admin puede usar `userId=` o `scope=all` para ver las de otros; el resto recibe 403). Admite filtros dinámicos tipados `filter[campo]` / `filter[campo][operador]` sobre `title`, `description`, `completed` y `createdAt` (operadores: `eq`, `contains`, `in`, `gte`, `lte` según el tipo); valores inválidos devuelven 400.",
  security: secured,
  request: { query: taskQuerySchema },
  responses: {
    200: jsonResponse(successSchema(z.array(taskSchema)), "Lista paginada de tareas"),
    ...errorResponses({
      400: "Parámetros o filtros inválidos",
      ...authErrors,
      403: "`userId` o `scope=all` sin ser Admin",
    }),
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Tasks"],
  summary: "Obtener una tarea",
  description:
    "Devuelve una tarea propia (un Admin puede leer cualquiera). Las tareas eliminadas (soft delete) solo se devuelven con `?includeDeleted=true`.",
  security: secured,
  request: { params: idParamSchema, query: detailQuerySchema },
  responses: {
    200: jsonResponse(successSchema(taskSchema), "Tarea"),
    ...errorResponses({
      ...authErrors,
      404: "Tarea no encontrada (o pertenece a otro usuario)",
    }),
  },
});

const createTaskRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Tasks"],
  summary: "Crear tarea",
  description: "Crea una tarea asignada automáticamente al usuario del token. Genera un AuditLog.",
  security: secured,
  request: jsonBody(createTaskSchema),
  responses: {
    201: jsonResponse(successSchema(taskSchema), "Tarea creada"),
    ...errorResponses({ 400: "Error de validación", ...authErrors }),
  },
});

const updateRoute = createRoute({
  method: "put",
  path: "/{id}",
  tags: ["Tasks"],
  summary: "Actualizar tarea",
  description: "Actualiza título, descripción o estado de una tarea propia. Genera un AuditLog.",
  security: secured,
  request: { params: idParamSchema, ...jsonBody(updateTaskSchema) },
  responses: {
    200: jsonResponse(successSchema(taskSchema), "Tarea actualizada"),
    ...errorResponses({
      400: "Error de validación",
      ...authErrors,
      404: "Tarea no encontrada (o pertenece a otro usuario)",
    }),
  },
});

const restoreRoute = createRoute({
  method: "post",
  path: "/{id}/restore",
  tags: ["Tasks"],
  summary: "Restaurar tarea eliminada",
  description: "Restaura una tarea eliminada con soft delete.",
  security: secured,
  request: { params: idParamSchema },
  responses: {
    200: jsonResponse(successSchema(taskSchema), "Tarea restaurada"),
    ...errorResponses({
      ...authErrors,
      404: "Tarea no encontrada (o pertenece a otro usuario)",
      409: "La tarea no está eliminada",
    }),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Tasks"],
  summary: "Eliminar tarea (soft delete por defecto)",
  description:
    "Marca `deletedAt` por defecto. Con `?permanent=true` elimina físicamente la tarea (también si ya estaba en soft delete).",
  security: secured,
  request: { params: idParamSchema, query: permanentQuerySchema },
  responses: {
    200: jsonResponse(
      successSchema(
        z.union([taskSchema, z.object({ id: z.string(), deletedPermanently: z.literal(true) })]),
      ),
      "Tarea eliminada (soft delete o permanente)",
    ),
    ...errorResponses({
      ...authErrors,
      404: "Tarea no encontrada (o ya eliminada, salvo con `permanent=true`)",
    }),
  },
});

export const taskRoutes = router
  /**
   * GET /api/tasks
   * Lists tasks belonging exclusively to the authenticated user with pagination and filters.
   */
  .openapi(listRoute, async (c) => {
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

    // Ownership filter: always the token's userId, except that admins may look at another user's
    // tasks (?userId=) or at everyone's (?scope=all). Everyone else asking for that gets 403.
    const { userId: requestedUserId, scope } = c.req.valid("query");
    if (requestedUserId || scope === "all") {
      if (currentUser.role !== "admin") {
        return errorResponse(c, "Only administrators can list other users' tasks.", 403);
      }
      if (requestedUserId) where.userId = requestedUserId;
    } else {
      where.userId = currentUser.userId;
    }

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
  })
  /**
   * GET /api/tasks/:id
   * Retrieves a single task ensuring strict ownership validation.
   * Soft-deleted tasks are only returned with ?includeDeleted=true.
   */
  .openapi(getRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { includeDeleted } = c.req.valid("query");
    const include = parseIncludes(c.req.query("include"), TASK_INCLUDES);

    const task = await prisma.task.findUnique({
      where: { id },
      include,
    });

    // Missing, soft-deleted and foreign tasks all answer 404 (no existence oracle for other users' IDs)
    // (administrators may read any task; writes stay owner-only)
    const viewer = c.get("user");
    if (
      !task ||
      (task.deletedAt && includeDeleted !== "true") ||
      (task.userId !== viewer.userId && viewer.role !== "admin")
    ) {
      return errorResponse(c, `Task with ID '${id}' not found.`, 404);
    }

    return successResponse(c, task);
  })
  /**
   * POST /api/tasks
   * Creates a new task bound strictly to the authenticated user.
   */
  .openapi(createTaskRoute, async (c) => {
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
  })
  /**
   * PUT /api/tasks/:id
   * Updates task properties (title, description, completed) verifying ownership.
   */
  .openapi(updateRoute, async (c) => {
    const { id } = c.req.valid("param");
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
  })
  /**
   * POST /api/tasks/:id/restore
   * Restores a soft-deleted task.
   */
  .openapi(restoreRoute, async (c) => {
    const { id } = c.req.valid("param");
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
  })
  /**
   * DELETE /api/tasks/:id
   * Soft deletes a task by setting deletedAt timestamp, or permanently deletes if ?permanent=true.
   */
  .openapi(deleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const isPermanent = c.req.valid("query").permanent === "true";

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
        { id, deletedPermanently: true as const },
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

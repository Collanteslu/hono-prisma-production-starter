/**
 * @file responses.ts
 * @description Response schemas. They document the API in the generated OpenAPI spec and are
 * checked against handler return values by the compiler (`app.openapi(route, handler)`).
 */

import { z } from "@hono/zod-openapi";

const dateTime = z.string().openapi({ format: "date-time", example: "2026-09-29T12:00:00.000Z" });
const nullableDateTime = dateTime.nullable();
// Stored as TEXT in SQLite (Prisma types it as `string`); allowed values are documented via `enum`
const roleSchema = z.string().openapi({ enum: ["admin", "user"], example: "user" });

export const metaSchema = z
  .object({
    requestId: z.string(),
    timestamp: dateTime,
    durationMs: z.number(),
    apiVersion: z.string().optional(),
  })
  .openapi("ResponseMeta");

export const paginationSchema = z
  .object({
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    totalPages: z.number().int(),
    hasNextPage: z.boolean(),
    hasPrevPage: z.boolean(),
  })
  .openapi("Pagination");

/** Error envelope shared by every non-2xx response */
export const errorSchema = z
  .object({
    success: z.literal(false),
    message: z.string(),
    details: z.unknown().optional(),
    errors: z
      .record(z.string(), z.array(z.string()))
      .optional()
      .openapi({ description: "Errores de validación por campo" }),
    meta: metaSchema.optional(),
  })
  .openapi("Error");

/** Success envelope wrapping a payload */
export const successSchema = <T extends z.ZodType>(data: T) =>
  z.object({
    success: z.literal(true),
    message: z.string().optional(),
    data,
    pagination: paginationSchema.optional(),
    meta: metaSchema,
  });

export const taskSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    title: z.string(),
    description: z.string(),
    completed: z.boolean(),
    deletedAt: nullableDateTime,
    createdAt: dateTime,
    user: z
      .object({ id: z.string(), name: z.string(), email: z.string(), role: roleSchema })
      .optional()
      .openapi({ description: "Presente con `?include=user`" }),
  })
  .openapi("Task");

export const sessionSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    userAgent: z.string().nullable(),
    ipAddress: z.string().nullable(),
    isActive: z.boolean(),
    expiresAt: dateTime,
    createdAt: dateTime,
    updatedAt: dateTime,
  })
  .openapi("Session");

export const userSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: roleSchema,
    isBlocked: z.boolean(),
    blockedReason: z.string().nullable(),
    deletedAt: nullableDateTime,
    createdAt: dateTime,
    tasks: z.array(taskSchema.omit({ user: true })).optional(),
    sessions: z.array(sessionSchema).optional(),
  })
  .openapi("User");

export const auditLogSchema = z
  .object({
    id: z.string(),
    userId: z.string().nullable(),
    action: z.string(),
    entity: z.string(),
    entityId: z.string().nullable(),
    details: z.unknown().nullable(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: dateTime,
    user: z
      .object({ id: z.string(), name: z.string(), email: z.string(), role: roleSchema })
      .nullable(),
  })
  .openapi("AuditLog");

const tokenFields = {
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().openapi({ description: "Segundos de vida del access token" }),
  sessionId: z.string(),
};

export const loginResponseSchema = z
  .object({
    success: z.literal(true),
    message: z.string(),
    ...tokenFields,
    user: z.object({ id: z.string(), name: z.string(), email: z.string(), role: roleSchema }),
    meta: metaSchema,
  })
  .openapi("LoginResponse");

export const refreshResponseSchema = z
  .object({
    success: z.literal(true),
    message: z.string(),
    ...tokenFields,
    meta: metaSchema,
  })
  .openapi("RefreshResponse");

export const sessionListResponseSchema = z
  .object({
    success: z.literal(true),
    count: z.number().int(),
    currentSessionId: z.string(),
    data: z.array(sessionSchema.extend({ isCurrent: z.boolean() })),
    meta: metaSchema,
  })
  .openapi("SessionListResponse");

export const healthResponseSchema = z
  .object({
    status: z.enum(["healthy", "unhealthy"]),
    timestamp: dateTime,
    uptimeSeconds: z.number().int().optional(),
    database: z.object({
      status: z.enum(["connected", "disconnected"]),
      latencyMs: z.number().optional(),
    }),
  })
  .openapi("HealthResponse");

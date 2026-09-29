/**
 * @file audit.ts
 * @description Audit logs query endpoints (restricted to admin users).
 */

import { createRoute, z } from "@hono/zod-openapi";
import { prisma } from "../db.js";
import type { AuditLogWhereInput } from "../generated/client/models.js";
import { parseAuditDetails } from "../lib/audit.js";
import { createRouter, errorResponses, jsonResponse, secured } from "../lib/openapi.js";
import { buildPagination, successResponse } from "../lib/response.js";
import { requireAdmin } from "../middleware/auth.js";
import { auditQuerySchema } from "../schemas/index.js";
import { auditLogSchema, successSchema } from "../schemas/responses.js";

const router = createRouter();

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Audit"],
  summary: "Consultar registros de auditoría (Solo Admin)",
  description:
    "Acciones registradas: LOGIN, LOGIN_FAILED, LOGOUT, REGISTER, CREATE, UPDATE, PASSWORD_CHANGE, SOFT_DELETE, RESTORE, DELETE_PERMANENT, BLOCK, UNBLOCK, REVOKE_SESSION, REVOKE_ALL_SESSIONS, TOKEN_REUSE_DETECTED.",
  security: secured,
  middleware: [requireAdmin] as const,
  request: { query: auditQuerySchema },
  responses: {
    200: jsonResponse(successSchema(z.array(auditLogSchema)), "Eventos de auditoría"),
    ...errorResponses({
      400: "Parámetros inválidos",
      401: "Token ausente, inválido o sesión revocada",
      403: "Requiere rol administrador",
    }),
  },
});

export const auditRoutes = router
  /**
   * GET /api/audit-logs
   * Retrieves security and action audit logs (Admin only).
   */
  .openapi(listRoute, async (c) => {
    const query = c.req.valid("query");
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const where: AuditLogWhereInput = {};
    if (query.entity) where.entity = query.entity;
    if (query.action) where.action = query.action;
    if (query.userId) where.userId = query.userId;

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
      }),
    ]);

    return successResponse(
      c,
      logs.map((l) => ({ ...l, details: parseAuditDetails(l.details) })),
      { pagination: buildPagination(total, page, limit) },
    );
  });

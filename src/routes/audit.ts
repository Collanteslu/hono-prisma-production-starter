/**
 * @file audit.ts
 * @description Audit logs query endpoints (restricted to admin users).
 */

import { Hono } from "hono";
import { prisma } from "../db.js";
import type { AuditLogWhereInput } from "../generated/client/models.js";
import { parseAuditDetails } from "../lib/audit.js";
import { buildPagination, successResponse } from "../lib/response.js";
import { requireAdmin } from "../middleware/auth.js";
import type { AppEnv } from "../types/index.js";

export const auditRoutes = new Hono<AppEnv>();

/**
 * GET /api/audit-logs
 * Retrieves security and action audit logs (Admin only).
 */
auditRoutes.get("/", requireAdmin, async (c) => {
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 20));
  const skip = (page - 1) * limit;
  const entity = c.req.query("entity");
  const action = c.req.query("action");
  const userId = c.req.query("userId");

  const where: AuditLogWhereInput = {};
  if (entity) where.entity = entity;
  if (action) where.action = action;
  if (userId) where.userId = userId;

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

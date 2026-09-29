/**
 * @file audit.ts
 * @description Audit logs query endpoints (restricted to admin users).
 */

import { Hono } from "hono";
import { prisma } from "../db.js";
import { successResponse } from "../lib/response.js";
import type { AppEnv, PaginationMeta } from "../types/index.js";

export const auditRoutes = new Hono<AppEnv>();

/**
 * GET /api/audit-logs
 * Retrieves security and action audit logs (Admin only).
 */
auditRoutes.get("/", async (c) => {
  const currentUser = c.get("user");
  if (currentUser.role !== "admin") {
    return c.json(
      {
        success: false,
        message: "Forbidden: Only administrators can access audit logs.",
      },
      403,
    );
  }

  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 20));
  const skip = (page - 1) * limit;
  const entity = c.req.query("entity");
  const action = c.req.query("action");

  const where: Record<string, unknown> = {};
  if (entity) where.entity = entity;
  if (action) where.action = action;

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

  const totalPages = Math.ceil(total / limit) || 1;
  const pagination: PaginationMeta = {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };

  return successResponse(
    c,
    logs.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
      details: l.details ? JSON.parse(l.details) : null,
    })),
    { pagination },
  );
});

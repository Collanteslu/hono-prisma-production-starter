/**
 * @file sessions.ts
 * @description Session management routes.
 * Allows users to inspect every session recorded for their account (the purge of expired and
 * long-inactive rows is left to the cleanup job), terminate specific sessions,
 * or revoke all active sessions immediately.
 */

import { createRoute, z } from "@hono/zod-openapi";
import { prisma } from "../db.js";
import { recordAudit } from "../lib/audit.js";
import { createRouter, errorResponses, jsonResponse, secured } from "../lib/openapi.js";
import { buildMeta, buildPagination, errorResponse, successResponse } from "../lib/response.js";
import { sessionIdParamSchema, sessionListQuerySchema } from "../schemas/index.js";
import { sessionListResponseSchema, successSchema } from "../schemas/responses.js";
import { revokeSession, revokeUserSessions } from "../services/sessions.js";

const emptySuccess = successSchema(z.null());

const listRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["Sessions"],
  summary: "Listar sesiones del usuario actual",
  description:
    "Devuelve los dispositivos con sesión registrada por el usuario autenticado, paginados (`page`, `limit`, por defecto 50), incluidas las sesiones ya revocadas o caducadas que la tarea de limpieza aún no ha purgado. `count` es el total.",
  security: secured,
  request: { query: sessionListQuerySchema },
  responses: {
    200: jsonResponse(sessionListResponseSchema, "Sesiones del usuario"),
    ...errorResponses({ 401: "Token ausente, inválido o sesión revocada" }),
  },
});

const revokeOneRoute = createRoute({
  method: "delete",
  path: "/{sessionId}",
  tags: ["Sessions"],
  summary: "Revocar una sesión específica",
  description:
    "Termina una sesión. Los tokens asociados dejan de funcionar de inmediato. Solo el dueño o un Admin.",
  security: secured,
  request: { params: sessionIdParamSchema },
  responses: {
    200: jsonResponse(emptySuccess, "Sesión revocada"),
    ...errorResponses({
      401: "Token ausente, inválido o sesión revocada",
      404: "Sesión no encontrada (o pertenece a otro usuario)",
    }),
  },
});

const revokeAllRoute = createRoute({
  method: "post",
  path: "/revoke-all",
  tags: ["Sessions"],
  summary: "Revocar todas las sesiones del usuario actual",
  description: "Invalida todas las sesiones activas del usuario en todos sus dispositivos.",
  security: secured,
  responses: {
    200: jsonResponse(emptySuccess, "Sesiones revocadas"),
    ...errorResponses({ 401: "Token ausente, inválido o sesión revocada" }),
  },
});

export const sessionRoutes = createRouter()
  /**
   * GET /api/sessions/me
   * Retrieves all sessions belonging to the currently authenticated user.
   */
  .openapi(listRoute, async (c) => {
    const currentUser = c.get("user");
    const { page, limit } = c.req.valid("query");
    const where = { userId: currentUser.userId };

    const [total, sessions] = await Promise.all([
      prisma.session.count({ where }),
      prisma.session.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return c.json(
      {
        success: true as const,
        count: total,
        currentSessionId: currentUser.sessionId,
        data: sessions.map((s) => ({
          ...s,
          isCurrent: s.id === currentUser.sessionId,
        })),
        pagination: buildPagination(total, page, limit),
        meta: buildMeta(c),
      },
      200,
    );
  })
  /**
   * DELETE /api/sessions/:sessionId
   * Terminates a specific session. Tokens tied to this session will be rejected immediately.
   */
  .openapi(revokeOneRoute, async (c) => {
    const { sessionId } = c.req.valid("param");
    const currentUser = c.get("user");

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    // Users can only revoke their own sessions (admins can revoke any). A foreign session answers
    // exactly like a missing one so session IDs cannot be probed for existence.
    if (!session || (session.userId !== currentUser.userId && currentUser.role !== "admin")) {
      return errorResponse(c, `Session with ID '${sessionId}' not found.`, 404);
    }

    await revokeSession(sessionId);

    await recordAudit(c, {
      userId: currentUser.userId,
      action: "REVOKE_SESSION",
      entity: "Session",
      entityId: sessionId,
      details: { ownerId: session.userId },
    });

    return successResponse(c, null, {
      message: `Session '${sessionId}' has been revoked successfully.`,
    });
  })
  /**
   * POST /api/sessions/revoke-all
   * Invalidates all active sessions for the current user across all devices.
   */
  .openapi(revokeAllRoute, async (c) => {
    const currentUser = c.get("user");

    const revokedCount = await revokeUserSessions(currentUser.userId);

    await recordAudit(c, {
      userId: currentUser.userId,
      action: "REVOKE_ALL_SESSIONS",
      entity: "User",
      entityId: currentUser.userId,
      details: { revokedCount },
    });

    return successResponse(c, null, {
      message: "All active sessions have been revoked. You must log in again.",
    });
  });

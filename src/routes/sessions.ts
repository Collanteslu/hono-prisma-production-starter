/**
 * @file sessions.ts
 * @description Session management routes.
 * Allows users to inspect all active sessions across devices, terminate specific sessions,
 * or revoke all active sessions immediately.
 */

import { Hono } from "hono";
import { prisma } from "../db.js";
import type { AppEnv } from "../types/index.js";

export const sessionRoutes = new Hono<AppEnv>();

/**
 * GET /api/sessions/me
 * Retrieves all sessions belonging to the currently authenticated user.
 */
sessionRoutes.get("/me", async (c) => {
  const currentUser = c.get("user");

  const sessions = await prisma.session.findMany({
    where: { userId: currentUser.userId },
    orderBy: { createdAt: "desc" },
  });

  return c.json({
    success: true,
    count: sessions.length,
    currentSessionId: currentUser.sessionId,
    data: sessions.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      isCurrent: s.id === currentUser.sessionId,
    })),
  });
});

/**
 * DELETE /api/sessions/:sessionId
 * Terminates a specific session. Tokens tied to this session will be rejected immediately.
 */
sessionRoutes.delete("/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const currentUser = c.get("user");

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    return c.json(
      {
        success: false,
        message: `Session with ID '${sessionId}' not found.`,
      },
      404,
    );
  }

  // Ownership verification: Users can only revoke their own sessions (admins can revoke any)
  if (session.userId !== currentUser.userId && currentUser.role !== "admin") {
    return c.json(
      {
        success: false,
        message: "Access denied: You cannot terminate sessions belonging to other users.",
      },
      403,
    );
  }

  // Deactivate session and purge associated refresh tokens
  await prisma.session.update({
    where: { id: sessionId },
    data: { isActive: false },
  });

  await prisma.refreshToken.deleteMany({
    where: { sessionId },
  });

  return c.json({
    success: true,
    message: `Session '${sessionId}' has been revoked successfully.`,
  });
});

/**
 * POST /api/sessions/revoke-all
 * Invalidates all active sessions for the current user across all devices.
 */
sessionRoutes.post("/revoke-all", async (c) => {
  const currentUser = c.get("user");

  await prisma.session.updateMany({
    where: { userId: currentUser.userId, isActive: true },
    data: { isActive: false },
  });

  await prisma.refreshToken.deleteMany({
    where: { userId: currentUser.userId },
  });

  return c.json({
    success: true,
    message: "All active sessions have been revoked. You must log in again.",
  });
});

import { Hono } from 'hono';
import { prisma } from '../db.js';
import { AppEnv } from '../types/index.js';

export const sessionRoutes = new Hono<AppEnv>();

/**
 * GET /api/sessions/me
 * Permite al usuario consultar todas sus sesiones (activas e inactivas).
 */
sessionRoutes.get('/me', async (c) => {
  const currentUser = c.get('user');

  const sessions = await prisma.session.findMany({
    where: { userId: currentUser.userId },
    orderBy: { createdAt: 'desc' }
  });

  return c.json({
    success: true,
    count: sessions.length,
    currentSessionId: currentUser.sessionId,
    data: sessions.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      isCurrent: s.id === currentUser.sessionId
    }))
  });
});

/**
 * DELETE /api/sessions/:sessionId
 * Cierra/tira una sesión específica del usuario (o cualquier sesión si es admin).
 */
sessionRoutes.delete('/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const currentUser = c.get('user');

  const session = await prisma.session.findUnique({
    where: { id: sessionId }
  });

  if (!session) {
    return c.json(
      {
        success: false,
        message: `Sesión con id '${sessionId}' no encontrada.`
      },
      404
    );
  }

  // Comprobar pertenencia (o ser admin)
  if (session.userId !== currentUser.userId && currentUser.role !== 'admin') {
    return c.json(
      {
        success: false,
        message: 'Acceso denegado: No tienes permiso para tirar sesiones de otros usuarios.'
      },
      403
    );
  }

  // Desactivar la sesión y borrar sus refresh tokens
  await prisma.session.update({
    where: { id: sessionId },
    data: { isActive: false }
  });

  await prisma.refreshToken.deleteMany({
    where: { sessionId }
  });

  return c.json({
    success: true,
    message: `Sesión '${sessionId}' cerrada con éxito. El token asociado ya no podrá realizar peticiones.`
  });
});

/**
 * POST /api/sessions/revoke-all
 * Permite al usuario tirar todas sus sesiones abiertas en otros dispositivos.
 */
sessionRoutes.post('/revoke-all', async (c) => {
  const currentUser = c.get('user');

  // Desactivar todas las sesiones del usuario
  await prisma.session.updateMany({
    where: { userId: currentUser.userId, isActive: true },
    data: { isActive: false }
  });

  // Eliminar todos sus refresh tokens
  await prisma.refreshToken.deleteMany({
    where: { userId: currentUser.userId }
  });

  return c.json({
    success: true,
    message: 'Todas las sesiones activas han sido revocadas. Deberás volver a iniciar sesión.'
  });
});

import { Context, Next } from 'hono';
import { verify } from 'hono/jwt';
import { JwtPayload, AppEnv } from '../types/index.js';
import { env } from '../config/env.js';
import { prisma } from '../db.js';

/**
 * Middleware de autenticación JWT con Stateful Session Check & Bloqueo de Usuario.
 * 
 * Además de verificar criptográficamente la firma del token:
 * 1. Comprueba que el usuario no esté BLOQUEADO en la base de datos (isBlocked: true).
 * 2. Comprueba que la SESIÓN específica siga ACTIVA en la base de datos (isActive: true).
 * 
 * Si un administrador bloquea al usuario o tira su sesión, este middleware rechaza
 * la petición inmediatamente, sin esperar a que el JWT expire.
 */
export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(
      {
        success: false,
        message: 'No autorizado: Falta el token de autorización (Bearer Token) en los headers.'
      },
      401
    );
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = (await verify(token, env.JWT_SECRET, 'HS256')) as unknown as JwtPayload;

    // 1. Verificar si el usuario existe y si está bloqueado
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, isBlocked: true, blockedReason: true }
    });

    if (!user) {
      return c.json(
        {
          success: false,
          message: 'No autorizado: El usuario asociado a este token ya no existe.'
        },
        401
      );
    }

    if (user.isBlocked) {
      return c.json(
        {
          success: false,
          message: `Acceso denegado: Tu cuenta ha sido bloqueada. Motivo: ${user.blockedReason || 'Violación de políticas de seguridad'}.`
        },
        403
      );
    }

    // 2. Si el token tiene sessionId, verificar que la sesión siga activa en SQLite
    if (payload.sessionId) {
      const session = await prisma.session.findUnique({
        where: { id: payload.sessionId }
      });

      if (!session || !session.isActive || session.expiresAt < new Date()) {
        return c.json(
          {
            success: false,
            message: 'Sesión revocada o finalizada. Has sido desconectado del sistema.'
          },
          401
        );
      }
    }

    c.set('user', payload);
    await next();
  } catch (error) {
    return c.json(
      {
        success: false,
        message: 'Token inválido o expirado.',
        error: error instanceof Error ? error.message : 'Error desconocido'
      },
      401
    );
  }
}

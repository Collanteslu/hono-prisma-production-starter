import { Context, Next } from 'hono';
import { verify } from 'hono/jwt';
import { JwtPayload, AppEnv } from '../types/index.js';
import { env } from '../config/env.js';

/**
 * Middleware de autenticación JWT.
 * Inspecciona la cabecera 'Authorization: Bearer <token>' y valida el token.
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

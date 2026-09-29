import { Context, Next } from 'hono';
import { randomUUID } from 'node:crypto';
import { AppEnv } from '../types/index.js';

/**
 * Middleware de correlación (Request ID).
 * Asigna un identificador único (UUID v4) a cada petición entrante y lo devuelve en la cabecera 'X-Request-Id'.
 * Permite trazabilidad en logs y debugging de problemas en producción.
 */
export async function requestIdMiddleware(c: Context<AppEnv>, next: Next) {
  const incomingId = c.req.header('X-Request-Id');
  const reqId = incomingId || randomUUID();

  c.set('requestId', reqId);
  c.header('X-Request-Id', reqId);

  await next();
}

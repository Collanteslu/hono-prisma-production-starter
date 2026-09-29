import { Context, Next } from 'hono';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

/**
 * Middleware de Rate Limiting en memoria.
 * Protege endpoints sensibles (como /login o registro) contra ataques de fuerza bruta o saturación.
 * 
 * @param windowMs Ventana de tiempo en milisegundos (ej: 60_000 para 1 minuto)
 * @param maxRequests Máximo de peticiones permitidas en esa ventana de tiempo
 */
export function rateLimiter(windowMs: number = 60_000, maxRequests: number = 10) {
  const ipStore = new Map<string, RateLimitRecord>();

  // Limpieza periódica de IPs antiguas para evitar consumo de memoria
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of ipStore.entries()) {
      if (now > record.resetAt) {
        ipStore.delete(ip);
      }
    }
  }, windowMs);

  return async (c: Context, next: Next) => {
    // Obtener IP del cliente (con soporte para proxies estándar)
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
      c.req.header('x-real-ip') ||
      'localhost';

    const now = Date.now();
    const clientRecord = ipStore.get(ip);

    if (!clientRecord || now > clientRecord.resetAt) {
      ipStore.set(ip, {
        count: 1,
        resetAt: now + windowMs
      });
      c.header('X-RateLimit-Limit', maxRequests.toString());
      c.header('X-RateLimit-Remaining', (maxRequests - 1).toString());
      await next();
      return;
    }

    if (clientRecord.count >= maxRequests) {
      const retryAfterSec = Math.ceil((clientRecord.resetAt - now) / 1000);
      c.header('Retry-After', retryAfterSec.toString());
      c.header('X-RateLimit-Limit', maxRequests.toString());
      c.header('X-RateLimit-Remaining', '0');

      return c.json(
        {
          success: false,
          message: 'Demasiadas peticiones. Por favor, intenta de nuevo más tarde.',
          retryAfterSeconds: retryAfterSec
        },
        429
      );
    }

    clientRecord.count++;
    c.header('X-RateLimit-Limit', maxRequests.toString());
    c.header('X-RateLimit-Remaining', (maxRequests - clientRecord.count).toString());

    await next();
  };
}

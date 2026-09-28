import { Context, Next } from 'hono';
import { verify } from 'hono/jwt';
import { JwtPayload, AppEnv } from '../types/index.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_seguro_hono_2026';

/**
 * Middleware de autenticación JWT.
 * 
 * ¿Cómo funciona?
 * 1. Inspecciona la cabecera 'Authorization' de la petición.
 * 2. Comprueba que tenga el formato 'Bearer <token>'.
 * 3. Utiliza la función nativa de Hono `verify(token, secret, 'HS256')` para validar firma y expiración.
 * 4. Almacena los datos del usuario decodificado en el contexto de Hono (`c.set('user', payload)`),
 *    permitiendo que los siguientes controladores accedan al usuario autenticado de forma tipada.
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
    // Verificamos el token con el algoritmo HS256
    const payload = (await verify(token, JWT_SECRET, 'HS256')) as unknown as JwtPayload;

    // Guardamos la información del usuario en el contexto 'c'
    c.set('user', payload);

    // Continuamos con el siguiente middleware o handler de la ruta
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

import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { comparePassword } from '../utils/password.js';
import { loginSchema, refreshTokenSchema, logoutSchema } from '../schemas/index.js';
import { rateLimiter } from '../middleware/rateLimit.js';

export const authRoutes = new Hono();

// Aplicar rate limiting estricto en rutas de autenticación (10 peticiones / minuto)
authRoutes.use('*', rateLimiter(60_000, 10));

/**
 * Función auxiliar para generar par de tokens (Access Token 15 min + Refresh Token 7 días)
 */
async function generateTokenPair(user: { id: string; email: string; role: string }) {
  const nowSec = Math.floor(Date.now() / 1000);

  // Access Token: 15 minutos (corta duración para mitigar robo)
  const accessExp = nowSec + 60 * 15;
  const accessToken = await sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      exp: accessExp
    },
    env.JWT_SECRET,
    'HS256'
  );

  // Refresh Token: 7 días
  const refreshExp = nowSec + 60 * 60 * 24 * 7;
  const refreshToken = await sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      exp: refreshExp
    },
    env.JWT_REFRESH_SECRET,
    'HS256'
  );

  // Guardar en la base de datos para control y revocación de sesión
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date(refreshExp * 1000)
    }
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: 60 * 15
  };
}

/**
 * POST /api/auth/login
 * Endpoint público para iniciar sesión con comparación segura de contraseña (bcrypt).
 */
authRoutes.post(
  '/login',
  zValidator('json', loginSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: 'Error de validación en los datos de entrada',
          errors: result.error.flatten().fieldErrors
        },
        400
      );
    }
  }),
  async (c) => {
    const { email, password } = c.req.valid('json');

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user) {
      return c.json(
        {
          success: false,
          message: 'Credenciales inválidas (usuario o contraseña incorrectos)'
        },
        401
      );
    }

    // Comparación segura con hash bcrypt
    const isValidPassword = await comparePassword(password, user.password);

    if (!isValidPassword) {
      return c.json(
        {
          success: false,
          message: 'Credenciales inválidas (usuario o contraseña incorrectos)'
        },
        401
      );
    }

    const tokens = await generateTokenPair(user);

    return c.json({
      success: true,
      message: 'Inicio de sesión exitoso',
      ...tokens,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  }
);

/**
 * POST /api/auth/refresh
 * Renueva el Access Token utilizando un Refresh Token válido almacenado en SQLite.
 * Implementa rotación de tokens (Token Rotation) para máxima seguridad.
 */
authRoutes.post(
  '/refresh',
  zValidator('json', refreshTokenSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: 'Token de refresco inválido o ausente',
          errors: result.error.flatten().fieldErrors
        },
        400
      );
    }
  }),
  async (c) => {
    const { refreshToken } = c.req.valid('json');

    try {
      // 1. Verificar firma criptográfica y expiración del refresh token
      const payload = (await verify(refreshToken, env.JWT_REFRESH_SECRET, 'HS256')) as unknown as {
        userId: string;
      };

      // 2. Verificar que exista en la base de datos (revocación de sesiones)
      const storedToken = await prisma.refreshToken.findUnique({
        where: { token: refreshToken }
      });

      if (!storedToken || storedToken.expiresAt < new Date()) {
        return c.json(
          {
            success: false,
            message: 'Refresh token expirado o revocado. Por favor, inicia sesión nuevamente.'
          },
          401
        );
      }

      // 3. Obtener el usuario asociado
      const user = await prisma.user.findUnique({
        where: { id: payload.userId }
      });

      if (!user) {
        return c.json(
          {
            success: false,
            message: 'Usuario no encontrado.'
          },
          404
        );
      }

      // 4. Token Rotation: Borrar el refresh token anterior y generar un nuevo par
      await prisma.refreshToken.delete({
        where: { id: storedToken.id }
      });

      const newTokens = await generateTokenPair(user);

      return c.json({
        success: true,
        message: 'Tokens renovados exitosamente (Token Rotation)',
        ...newTokens
      });
    } catch (err) {
      return c.json(
        {
          success: false,
          message: 'Refresh token inválido o corrupto.'
        },
        401
      );
    }
  }
);

/**
 * POST /api/auth/logout
 * Revoca el Refresh Token en la base de datos cerrando la sesión de forma efectiva.
 */
authRoutes.post(
  '/logout',
  zValidator('json', logoutSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: 'Token de refresco requerido para cerrar sesión',
          errors: result.error.flatten().fieldErrors
        },
        400
      );
    }
  }),
  async (c) => {
    const { refreshToken } = c.req.valid('json');

    try {
      await prisma.refreshToken.deleteMany({
        where: { token: refreshToken }
      });

      return c.json({
        success: true,
        message: 'Sesión cerrada exitosamente. Token revocado.'
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          message: 'Error al procesar el cierre de sesión.'
        },
        500
      );
    }
  }
);

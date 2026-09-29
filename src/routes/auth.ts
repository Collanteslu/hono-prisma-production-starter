import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { comparePassword } from '../utils/password.js';
import { loginSchema, refreshTokenSchema, logoutSchema } from '../schemas/index.js';
import { rateLimiter } from '../middleware/rateLimit.js';
import { AppEnv } from '../types/index.js';

export const authRoutes = new Hono<AppEnv>();

// Aplicar rate limiting estricto en rutas de autenticación (10 peticiones / minuto)
authRoutes.use('/login', rateLimiter(60_000, 10));

/**
 * Función para generar par de tokens asociados a una Sesión registrada en SQLite.
 */
async function createSessionAndTokens(
  user: { id: string; email: string; role: string },
  userAgent?: string,
  ipAddress?: string
) {
  const nowSec = Math.floor(Date.now() / 1000);

  // 1. Crear la sesión en SQLite (expira en 7 días)
  const sessionExpDate = new Date((nowSec + 60 * 60 * 24 * 7) * 1000);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      userAgent: userAgent || 'Desconocido',
      ipAddress: ipAddress || 'localhost',
      isActive: true,
      expiresAt: sessionExpDate
    }
  });

  // 2. Access Token (15 minutos) vinculado a la sessionId
  const accessExp = nowSec + 60 * 15;
  const accessToken = await sign(
    {
      userId: user.id,
      sessionId: session.id, // Vínculo directo a la sesión
      email: user.email,
      role: user.role,
      exp: accessExp
    },
    env.JWT_SECRET,
    'HS256'
  );

  // 3. Refresh Token (7 días) vinculado a la sesión
  const refreshExp = nowSec + 60 * 60 * 24 * 7;
  const refreshToken = await sign(
    {
      userId: user.id,
      sessionId: session.id,
      email: user.email,
      role: user.role,
      exp: refreshExp
    },
    env.JWT_REFRESH_SECRET,
    'HS256'
  );

  // 4. Guardar Refresh Token en la base de datos
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      sessionId: session.id,
      expiresAt: new Date(refreshExp * 1000)
    }
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: 60 * 15,
    sessionId: session.id
  };
}

/**
 * POST /api/auth/login
 * Inicia sesión verificando si el usuario no está bloqueado y creando un registro de Session.
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

    // Verificar si el usuario está bloqueado
    if (user.isBlocked) {
      return c.json(
        {
          success: false,
          message: `Acceso denegado: Tu cuenta se encuentra bloqueada. Motivo: ${user.blockedReason || 'Contacto con soporte técnico'}.`
        },
        403
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

    const userAgent = c.req.header('user-agent');
    const ipAddress =
      c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
      c.req.header('x-real-ip') ||
      'localhost';

    const sessionData = await createSessionAndTokens(user, userAgent, ipAddress);

    return c.json({
      success: true,
      message: 'Inicio de sesión exitoso',
      ...sessionData,
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
 * Renueva el Access Token validando la sesión en base de datos (Token Rotation).
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
      const payload = (await verify(refreshToken, env.JWT_REFRESH_SECRET, 'HS256')) as unknown as {
        userId: string;
        sessionId?: string;
      };

      // 1. Verificar si el usuario está bloqueado
      const user = await prisma.user.findUnique({
        where: { id: payload.userId }
      });

      if (!user || user.isBlocked) {
        return c.json(
          {
            success: false,
            message: 'Acceso denegado: El usuario no existe o está bloqueado.'
          },
          403
        );
      }

      // 2. Verificar que la sesión en base de datos esté activa
      if (payload.sessionId) {
        const session = await prisma.session.findUnique({
          where: { id: payload.sessionId }
        });

        if (!session || !session.isActive || session.expiresAt < new Date()) {
          return c.json(
            {
              success: false,
              message: 'La sesión asociada ha sido revocada o tirada por el administrador.'
            },
            401
          );
        }
      }

      // 3. Verificar que el refresh token exista y no esté expirado
      const storedToken = await prisma.refreshToken.findUnique({
        where: { token: refreshToken }
      });

      if (!storedToken || storedToken.expiresAt < new Date()) {
        return c.json(
          {
            success: false,
            message: 'Refresh token expirado o revocado. Inicia sesión nuevamente.'
          },
          401
        );
      }

      // 4. Token Rotation: Borrar refresh token viejo y crear un nuevo par dentro de la misma sesión
      await prisma.refreshToken.delete({
        where: { id: storedToken.id }
      });

      const nowSec = Math.floor(Date.now() / 1000);
      const accessExp = nowSec + 60 * 15;
      const newAccessToken = await sign(
        {
          userId: user.id,
          sessionId: payload.sessionId || '',
          email: user.email,
          role: user.role,
          exp: accessExp
        },
        env.JWT_SECRET,
        'HS256'
      );

      const refreshExp = nowSec + 60 * 60 * 24 * 7;
      const newRefreshToken = await sign(
        {
          userId: user.id,
          sessionId: payload.sessionId || '',
          email: user.email,
          role: user.role,
          exp: refreshExp
        },
        env.JWT_REFRESH_SECRET,
        'HS256'
      );

      await prisma.refreshToken.create({
        data: {
          token: newRefreshToken,
          userId: user.id,
          sessionId: payload.sessionId,
          expiresAt: new Date(refreshExp * 1000)
        }
      });

      return c.json({
        success: true,
        message: 'Tokens renovados exitosamente (Token Rotation)',
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 60 * 15,
        sessionId: payload.sessionId
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
 * Desactiva la sesión en base de datos y revoca los refresh tokens.
 */
authRoutes.post(
  '/logout',
  zValidator('json', logoutSchema),
  async (c) => {
    const { refreshToken } = c.req.valid('json');
    const authHeader = c.req.header('Authorization');

    try {
      // 1. Si viene por header Bearer, desactivar la sesión actual
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
          const payload = (await verify(token, env.JWT_SECRET, 'HS256')) as unknown as { sessionId?: string };
          if (payload.sessionId) {
            await prisma.session.update({
              where: { id: payload.sessionId },
              data: { isActive: false }
            });
            await prisma.refreshToken.deleteMany({
              where: { sessionId: payload.sessionId }
            });
          }
        } catch (_) {}
      }

      // 2. Si envió un refreshToken en el body, asegurarse de borrarlo y desactivar su sesión
      if (refreshToken) {
        const stored = await prisma.refreshToken.findUnique({
          where: { token: refreshToken }
        });
        if (stored?.sessionId) {
          await prisma.session.updateMany({
            where: { id: stored.sessionId },
            data: { isActive: false }
          });
        }
        await prisma.refreshToken.deleteMany({
          where: { token: refreshToken }
        });
      }

      return c.json({
        success: true,
        message: 'Sesión cerrada y revocada en base de datos exitosamente.'
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

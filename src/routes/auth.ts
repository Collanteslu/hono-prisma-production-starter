import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../db.js';
import { JWT_SECRET } from '../middleware/auth.js';
import { loginSchema } from '../schemas/index.js';

export const authRoutes = new Hono();

/**
 * POST /api/auth/login
 * Endpoint público para iniciar sesión y obtener un JWT.
 * 
 * Valida automáticamente el body con Zod mediante zValidator.
 * Consulta al usuario en la base de datos SQLite con Prisma 7.
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

    // Buscamos al usuario en SQLite mediante Prisma
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user || user.password !== password) {
      return c.json(
        {
          success: false,
          message: 'Credenciales inválidas (usuario o contraseña incorrectos)'
        },
        401
      );
    }

    // Generamos el payload para el JWT (expira en 24 horas)
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
    const token = await sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role as 'admin' | 'user',
        exp
      },
      JWT_SECRET,
      'HS256'
    );

    return c.json({
      success: true,
      message: 'Inicio de sesión exitoso',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  }
);

import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { users } from '../db.js';
import { JWT_SECRET } from '../middleware/auth.js';

export const authRoutes = new Hono();

/**
 * POST /api/auth/login
 * Endpoint público para iniciar sesión y obtener un JWT.
 * 
 * Flujo:
 * 1. Recibe 'email' y 'password' en el cuerpo JSON.
 * 2. Busca al usuario en la base de datos simulada.
 * 3. Valida credenciales.
 * 4. Firma un token JWT con tiempo de expiración (24 horas).
 * 5. Devuelve el token y los datos esenciales del usuario.
 */
authRoutes.post('/login', async (c) => {
  try {
    const body = await c.req.json();
    const { email, password } = body;

    // Validación básica de campos requeridos
    if (!email || !password) {
      return c.json(
        {
          success: false,
          message: 'Email y contraseña son obligatorios'
        },
        400
      );
    }

    // Buscamos al usuario por correo
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());

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
        role: user.role,
        exp
      },
      JWT_SECRET
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
  } catch (err) {
    return c.json(
      {
        success: false,
        message: 'Error al procesar la solicitud de inicio de sesión'
      },
      500
    );
  }
});

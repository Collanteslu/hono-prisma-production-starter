import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../db.js';
import { AppEnv } from '../types/index.js';
import { createUserSchema, updateUserSchema } from '../schemas/index.js';

export const userRoutes = new Hono<AppEnv>();

/**
 * Función auxiliar para limpiar la contraseña antes de responder al cliente.
 */
function sanitizeUser(user: { id: string; name: string; email: string; role: string; createdAt: Date }) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString()
  };
}

/**
 * GET /api/users
 * Devuelve la lista completa de usuarios desde SQLite (sin contraseñas).
 */
userRoutes.get('/', async (c) => {
  const allUsers = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' }
  });

  return c.json({
    success: true,
    count: allUsers.length,
    data: allUsers.map(sanitizeUser)
  });
});

/**
 * GET /api/users/:id
 * Obtiene los detalles de un usuario específico por su ID.
 */
userRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const user = await prisma.user.findUnique({
    where: { id }
  });

  if (!user) {
    return c.json(
      {
        success: false,
        message: `Usuario con id '${id}' no encontrado.`
      },
      404
    );
  }

  return c.json({
    success: true,
    data: sanitizeUser(user)
  });
});

/**
 * POST /api/users
 * Crea un nuevo usuario en SQLite con validación estricta de Zod.
 * Solo administradores pueden asignar roles de 'admin'; por defecto se crea con rol 'user'.
 */
userRoutes.post(
  '/',
  zValidator('json', createUserSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: 'Error de validación al crear usuario',
          errors: result.error.flatten().fieldErrors
        },
        400
      );
    }
  }),
  async (c) => {
    const { name, email, password, role } = c.req.valid('json');

    // Verificar si el email ya existe en SQLite
    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existing) {
      return c.json(
        {
          success: false,
          message: `El email '${email}' ya se encuentra registrado.`
        },
        409
      );
    }

    // Comprobamos el usuario logueado desde el contexto tipado
    const currentUser = c.get('user');
    const finalRole: 'admin' | 'user' =
      role === 'admin' && currentUser?.role === 'admin' ? 'admin' : 'user';

    const newUser = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        password,
        role: finalRole
      }
    });

    return c.json(
      {
        success: true,
        message: 'Usuario creado exitosamente.',
        data: sanitizeUser(newUser)
      },
      201
    );
  }
);

/**
 * PUT /api/users/:id
 * Actualiza los datos de un usuario existente previa validación Zod.
 */
userRoutes.put(
  '/:id',
  zValidator('json', updateUserSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: 'Error de validación al actualizar usuario',
          errors: result.error.flatten().fieldErrors
        },
        400
      );
    }
  }),
  async (c) => {
    const id = c.req.param('id');

    const existingUser = await prisma.user.findUnique({
      where: { id }
    });

    if (!existingUser) {
      return c.json(
        {
          success: false,
          message: `Usuario con id '${id}' no encontrado.`
        },
        404
      );
    }

    const { name, email, password } = c.req.valid('json');

    // Si intenta cambiar el email, validamos que no pertenezca a otro usuario
    if (email && email.toLowerCase() !== existingUser.email) {
      const emailTaken = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });
      if (emailTaken) {
        return c.json(
          {
            success: false,
            message: `El email '${email}' ya está en uso por otro usuario.`
          },
          409
        );
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(email && { email: email.toLowerCase() }),
        ...(password && { password })
      }
    });

    return c.json({
      success: true,
      message: 'Usuario actualizado correctamente.',
      data: sanitizeUser(updatedUser)
    });
  }
);

/**
 * DELETE /api/users/:id
 * Elimina un usuario. La configuración en Prisma onDelete: Cascade borra automáticamente sus tareas.
 */
userRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const existingUser = await prisma.user.findUnique({
    where: { id }
  });

  if (!existingUser) {
    return c.json(
      {
        success: false,
        message: `Usuario con id '${id}' no encontrado.`
      },
      404
    );
  }

  // Contamos cuántas tareas se borrarán antes de eliminar
  const tasksCount = await prisma.task.count({ where: { userId: id } });

  // Al borrar el usuario, Prisma y SQLite eliminan sus tareas asociadas en cascada
  await prisma.user.delete({
    where: { id }
  });

  return c.json({
    success: true,
    message: `Usuario '${existingUser.name}' eliminado con éxito, junto a sus ${tasksCount} tarea(s) asociadas.`,
    data: sanitizeUser(existingUser)
  });
});

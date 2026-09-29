import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../db.js';
import { AppEnv, PaginationMeta } from '../types/index.js';
import { createUserSchema, updateUserSchema, userQuerySchema } from '../schemas/index.js';
import { hashPassword } from '../utils/password.js';

export const userRoutes = new Hono<AppEnv>();

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
 * Lista usuarios con paginación, búsqueda por nombre o email, y ordenación.
 */
userRoutes.get(
  '/',
  zValidator('query', userQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: 'Parámetros de consulta inválidos',
          errors: result.error.flatten().fieldErrors
        },
        400
      );
    }
  }),
  async (c) => {
    const { page, limit, search, role, sortBy, order } = c.req.valid('query');
    const skip = (page - 1) * limit;

    // Filtros dinámicos con Prisma
    const where: any = {};

    if (role) {
      where.role = role;
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } }
      ];
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: order }
      })
    ]);

    const totalPages = Math.ceil(total / limit) || 1;
    const pagination: PaginationMeta = {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    };

    return c.json({
      success: true,
      pagination,
      data: users.map(sanitizeUser)
    });
  }
);

/**
 * GET /api/users/:id
 * Detalle de un usuario específico.
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
 * Crea un nuevo usuario con contraseña hasheada (bcrypt).
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

    const currentUser = c.get('user');
    const finalRole: 'admin' | 'user' =
      role === 'admin' && currentUser?.role === 'admin' ? 'admin' : 'user';

    // Hashear contraseña antes de almacenar en la base de datos
    const hashedPassword = await hashPassword(password);

    const newUser = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        role: finalRole
      }
    });

    return c.json(
      {
        success: true,
        message: 'Usuario creado exitosamente con contraseña segura.',
        data: sanitizeUser(newUser)
      },
      201
    );
  }
);

/**
 * PUT /api/users/:id
 * Actualiza los datos de un usuario existente.
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

    let hashedPasswordUpdate: string | undefined;
    if (password) {
      hashedPasswordUpdate = await hashPassword(password);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(email && { email: email.toLowerCase() }),
        ...(hashedPasswordUpdate && { password: hashedPasswordUpdate })
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
 * Elimina un usuario y borra en cascada sus tareas y refresh tokens.
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

  const tasksCount = await prisma.task.count({ where: { userId: id } });

  await prisma.user.delete({
    where: { id }
  });

  return c.json({
    success: true,
    message: `Usuario '${existingUser.name}' eliminado con éxito, junto a sus ${tasksCount} tarea(s) asociadas.`,
    data: sanitizeUser(existingUser)
  });
});

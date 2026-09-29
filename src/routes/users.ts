import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../db.js';
import { AppEnv, PaginationMeta } from '../types/index.js';
import { createUserSchema, updateUserSchema, userQuerySchema, blockUserSchema } from '../schemas/index.js';
import { hashPassword } from '../utils/password.js';

export const userRoutes = new Hono<AppEnv>();

function sanitizeUser(user: {
  id: string;
  name: string;
  email: string;
  role: string;
  isBlocked: boolean;
  blockedReason?: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isBlocked: user.isBlocked,
    blockedReason: user.blockedReason,
    createdAt: user.createdAt.toISOString()
  };
}

/**
 * GET /api/users
 * Lista usuarios con paginación, filtros de rol y bloqueo, y búsqueda.
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
    const { page, limit, search, role, isBlocked, sortBy, order } = c.req.valid('query');
    const skip = (page - 1) * limit;

    const where: any = {};

    if (role) {
      where.role = role;
    }

    if (isBlocked !== undefined) {
      where.isBlocked = isBlocked === 'true';
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
 * Crea un nuevo usuario.
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
 * PATCH /api/users/:id/block
 * Endpoint para BLOQUEAR o DESBLOQUEAR un usuario.
 * Solo administradores pueden ejecutar esta acción.
 * Si se bloquea al usuario, se tiran automáticamente todas sus sesiones activas de inmediato.
 */
userRoutes.patch(
  '/:id/block',
  zValidator('json', blockUserSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: 'Error de validación en la acción de bloqueo',
          errors: result.error.flatten().fieldErrors
        },
        400
      );
    }
  }),
  async (c) => {
    const id = c.req.param('id');
    const currentUser = c.get('user');

    // Control de rol: Solo administradores pueden bloquear
    if (currentUser.role !== 'admin') {
      return c.json(
        {
          success: false,
          message: 'Acceso denegado: Solo administradores pueden bloquear o desbloquear usuarios.'
        },
        403
      );
    }

    // No permitir que el admin se auto-bloquee por accidente
    if (currentUser.userId === id) {
      return c.json(
        {
          success: false,
          message: 'Acción inválida: No puedes bloquear tu propia cuenta de administrador.'
        },
        400
      );
    }

    const targetUser = await prisma.user.findUnique({
      where: { id }
    });

    if (!targetUser) {
      return c.json(
        {
          success: false,
          message: `Usuario con id '${id}' no encontrado.`
        },
        404
      );
    }

    const { isBlocked, reason } = c.req.valid('json');

    // 1. Actualizar el estado de bloqueo en la base de datos
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        isBlocked,
        blockedReason: isBlocked ? (reason || 'Bloqueado por el administrador') : null
      }
    });

    // 2. Si fue bloqueado, TIRAR INMEDIATAMENTE todas sus sesiones y refresh tokens
    let revokedSessionsCount = 0;
    if (isBlocked) {
      const res = await prisma.session.updateMany({
        where: { userId: id, isActive: true },
        data: { isActive: false }
      });
      revokedSessionsCount = res.count;

      await prisma.refreshToken.deleteMany({
        where: { userId: id }
      });
    }

    return c.json({
      success: true,
      message: isBlocked
        ? `Usuario '${updatedUser.name}' ha sido bloqueado exitosamente y se tiraron sus ${revokedSessionsCount} sesión(es) activas.`
        : `Usuario '${updatedUser.name}' ha sido desbloqueado exitosamente.`,
      data: sanitizeUser(updatedUser)
    });
  }
);

/**
 * POST /api/users/:id/revoke-sessions
 * Permite a un administrador o al propio usuario tirar todas las sesiones activas de un usuario.
 */
userRoutes.post('/:id/revoke-sessions', async (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');

  if (currentUser.userId !== id && currentUser.role !== 'admin') {
    return c.json(
      {
        success: false,
        message: 'Acceso denegado: Solo puedes revocar tus propias sesiones o ser administrador.'
      },
      403
    );
  }

  const res = await prisma.session.updateMany({
    where: { userId: id, isActive: true },
    data: { isActive: false }
  });

  await prisma.refreshToken.deleteMany({
    where: { userId: id }
  });

  return c.json({
    success: true,
    message: `Se han cerrado y revocado ${res.count} sesión(es) activas del usuario.`
  });
});

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
 * Elimina un usuario y borra en cascada sus tareas, sesiones y refresh tokens.
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

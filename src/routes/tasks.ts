import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../db.js';
import { AppEnv, PaginationMeta } from '../types/index.js';
import { createTaskSchema, updateTaskSchema, taskQuerySchema } from '../schemas/index.js';

export const taskRoutes = new Hono<AppEnv>();

/**
 * GET /api/tasks
 * Lista paginada de tareas exclusivas del usuario autenticado.
 * Soporta filtros:
 *  - page: número de página (default: 1)
 *  - limit: cantidad por página (default: 10, max: 100)
 *  - search: búsqueda textual en título y descripción
 *  - completed: 'true' o 'false'
 *  - sortBy: 'createdAt' o 'title'
 *  - order: 'asc' o 'desc'
 */
taskRoutes.get(
  '/',
  zValidator('query', taskQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: 'Parámetros de consulta de tareas inválidos',
          errors: result.error.flatten().fieldErrors
        },
        400
      );
    }
  }),
  async (c) => {
    const currentUser = c.get('user');
    const { page, limit, search, completed, sortBy, order } = c.req.valid('query');
    const skip = (page - 1) * limit;

    // Filtro base: pertenencia al usuario del token
    const where: any = {
      userId: currentUser.userId
    };

    if (completed !== undefined) {
      where.completed = completed === 'true';
    }

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } }
      ];
    }

    const [total, tasks] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
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
      data: tasks.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString()
      }))
    });
  }
);

/**
 * GET /api/tasks/:id
 * Obtiene una tarea por su ID solo si le pertenece al usuario del token.
 */
taskRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');

  const task = await prisma.task.findUnique({
    where: { id }
  });

  if (!task) {
    return c.json(
      {
        success: false,
        message: `Tarea con id '${id}' no encontrada.`
      },
      404
    );
  }

  // Verificamos propiedad estricta
  if (task.userId !== currentUser.userId) {
    return c.json(
      {
        success: false,
        message: 'Acceso denegado: Esta tarea no te pertenece.'
      },
      403
    );
  }

  return c.json({
    success: true,
    data: {
      ...task,
      createdAt: task.createdAt.toISOString()
    }
  });
});

/**
 * POST /api/tasks
 * Crea una nueva tarea asignada directamente al usuario autenticado en el token.
 */
taskRoutes.post(
  '/',
  zValidator('json', createTaskSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: 'Error de validación al crear tarea',
          errors: result.error.flatten().fieldErrors
        },
        400
      );
    }
  }),
  async (c) => {
    const { title, description, completed } = c.req.valid('json');
    const currentUser = c.get('user');

    const newTask = await prisma.task.create({
      data: {
        userId: currentUser.userId,
        title,
        description: description || '',
        completed: Boolean(completed)
      }
    });

    return c.json(
      {
        success: true,
        message: 'Tarea creada exitosamente.',
        data: {
          ...newTask,
          createdAt: newTask.createdAt.toISOString()
        }
      },
      201
    );
  }
);

/**
 * PUT /api/tasks/:id
 * Actualiza una tarea únicamente si pertenece al usuario del token.
 */
taskRoutes.put(
  '/:id',
  zValidator('json', updateTaskSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: 'Error de validación al actualizar tarea',
          errors: result.error.flatten().fieldErrors
        },
        400
      );
    }
  }),
  async (c) => {
    const id = c.req.param('id');
    const currentUser = c.get('user');

    const existingTask = await prisma.task.findUnique({
      where: { id }
    });

    if (!existingTask) {
      return c.json(
        {
          success: false,
          message: `Tarea con id '${id}' no encontrada.`
        },
        404
      );
    }

    if (existingTask.userId !== currentUser.userId) {
      return c.json(
        {
          success: false,
          message: 'Acceso denegado: No puedes modificar tareas que no te pertenecen.'
        },
        403
      );
    }

    const { title, description, completed } = c.req.valid('json');

    const updatedTask = await prisma.task.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(completed !== undefined && { completed })
      }
    });

    return c.json({
      success: true,
      message: 'Tarea actualizada exitosamente.',
      data: {
        ...updatedTask,
        createdAt: updatedTask.createdAt.toISOString()
      }
    });
  }
);

/**
 * DELETE /api/tasks/:id
 * Elimina una tarea solo si pertenece al usuario del token.
 */
taskRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');

  const existingTask = await prisma.task.findUnique({
    where: { id }
  });

  if (!existingTask) {
    return c.json(
      {
        success: false,
        message: `Tarea con id '${id}' no encontrada.`
      },
      404
    );
  }

  if (existingTask.userId !== currentUser.userId) {
    return c.json(
      {
        success: false,
        message: 'Acceso denegado: No puedes eliminar tareas que no te pertenecen.'
      },
      403
    );
  }

  const deletedTask = await prisma.task.delete({
    where: { id }
  });

  return c.json({
    success: true,
    message: 'Tarea eliminada correctamente.',
    data: {
      ...deletedTask,
      createdAt: deletedTask.createdAt.toISOString()
    }
  });
});

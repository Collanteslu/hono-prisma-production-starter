import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../db.js';
import { AppEnv } from '../types/index.js';
import { createTaskSchema, updateTaskSchema } from '../schemas/index.js';

export const taskRoutes = new Hono<AppEnv>();

/**
 * GET /api/tasks
 * Devuelve ÚNICAMENTE las tareas que pertenecen al usuario autenticado en el token JWT.
 * Consulta directamente a SQLite filtrando por userId.
 */
taskRoutes.get('/', async (c) => {
  const currentUser = c.get('user');

  const userTasks = await prisma.task.findMany({
    where: { userId: currentUser.userId },
    orderBy: { createdAt: 'desc' }
  });

  return c.json({
    success: true,
    count: userTasks.length,
    data: userTasks.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString()
    }))
  });
});

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
 * Crea una nueva tarea en SQLite asignada directamente al usuario autenticado en el token.
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

    // Comprobamos propiedad estricta
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

  // Comprobamos propiedad estricta
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

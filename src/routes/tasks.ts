import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { tasks, users } from '../db.js';
import { Task, AppEnv } from '../types/index.js';
import { createTaskSchema, updateTaskSchema } from '../schemas/index.js';

export const taskRoutes = new Hono<AppEnv>();

/**
 * GET /api/tasks
 * Lista todas las tareas disponibles.
 * Permite filtrar por usuario mediante query param opcional: ?userId=user-1
 */
taskRoutes.get('/', (c) => {
  const queryUserId = c.req.query('userId');

  const filteredTasks = queryUserId
    ? tasks.filter((t) => t.userId === queryUserId)
    : tasks;

  return c.json({
    success: true,
    count: filteredTasks.length,
    data: filteredTasks
  });
});

/**
 * GET /api/tasks/:id
 * Obtiene el detalle de una tarea por su ID.
 */
taskRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  const task = tasks.find((t) => t.id === id);

  if (!task) {
    return c.json(
      {
        success: false,
        message: `Tarea con id '${id}' no encontrada.`
      },
      404
    );
  }

  return c.json({
    success: true,
    data: task
  });
});

/**
 * POST /api/tasks
 * Crea una nueva tarea asociada a un usuario, validando la entrada con Zod.
 * Si no se especifica 'userId' en el cuerpo, se asocia automáticamente al usuario autenticado.
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
    const { title, description, completed, userId } = c.req.valid('json');
    const currentUser = c.get('user');

    // Determinamos qué usuario será el dueño de la tarea
    const targetUserId = userId || currentUser?.userId;

    if (!targetUserId) {
      return c.json(
        {
          success: false,
          message: 'No se pudo determinar el usuario para asignar la tarea.'
        },
        400
      );
    }

    // Validamos que el usuario realmente exista en el sistema
    const userExists = users.some((u) => u.id === targetUserId);
    if (!userExists) {
      return c.json(
        {
          success: false,
          message: `El usuario con id '${targetUserId}' no existe.`
        },
        404
      );
    }

    const newTask: Task = {
      id: `task-${Date.now()}`,
      userId: targetUserId,
      title,
      description: description || '',
      completed: Boolean(completed),
      createdAt: new Date().toISOString()
    };

    tasks.push(newTask);

    return c.json(
      {
        success: true,
        message: 'Tarea creada exitosamente.',
        data: newTask
      },
      201
    );
  }
);

/**
 * PUT /api/tasks/:id
 * Actualiza una tarea existente previa validación Zod.
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
    const taskIndex = tasks.findIndex((t) => t.id === id);

    if (taskIndex === -1) {
      return c.json(
        {
          success: false,
          message: `Tarea con id '${id}' no encontrada.`
        },
        404
      );
    }

    const { title, description, completed, userId } = c.req.valid('json');

    // Si se desea reasignar la tarea a otro usuario, verificamos que el nuevo usuario exista
    if (userId) {
      const userExists = users.some((u) => u.id === userId);
      if (!userExists) {
        return c.json(
          {
            success: false,
            message: `El usuario con id '${userId}' no existe para reasignar la tarea.`
          },
          404
        );
      }
      tasks[taskIndex].userId = userId;
    }

    if (title !== undefined) tasks[taskIndex].title = title;
    if (description !== undefined) tasks[taskIndex].description = description;
    if (completed !== undefined) tasks[taskIndex].completed = completed;

    return c.json({
      success: true,
      message: 'Tarea actualizada exitosamente.',
      data: tasks[taskIndex]
    });
  }
);

/**
 * DELETE /api/tasks/:id
 * Elimina una tarea por su identificador.
 */
taskRoutes.delete('/:id', (c) => {
  const id = c.req.param('id');
  const taskIndex = tasks.findIndex((t) => t.id === id);

  if (taskIndex === -1) {
    return c.json(
      {
        success: false,
        message: `Tarea con id '${id}' no encontrada.`
      },
      404
    );
  }

  const deletedTask = tasks.splice(taskIndex, 1)[0];

  return c.json({
    success: true,
    message: 'Tarea eliminada correctamente.',
    data: deletedTask
  });
});

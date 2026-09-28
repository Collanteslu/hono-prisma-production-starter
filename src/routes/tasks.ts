import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { tasks } from '../db.js';
import { Task, AppEnv } from '../types/index.js';
import { createTaskSchema, updateTaskSchema } from '../schemas/index.js';

export const taskRoutes = new Hono<AppEnv>();

/**
 * GET /api/tasks
 * Devuelve ÚNICAMENTE las tareas que pertenecen al usuario autenticado en el token JWT.
 * No admite ni necesita parámetros de filtrado externo: el aislamiento es total.
 */
taskRoutes.get('/', (c) => {
  const currentUser = c.get('user');

  // Filtro estricto por el ID del usuario en sesión
  const userTasks = tasks.filter((t) => t.userId === currentUser.userId);

  return c.json({
    success: true,
    count: userTasks.length,
    data: userTasks
  });
});

/**
 * GET /api/tasks/:id
 * Obtiene una tarea por su ID solo si le pertenece al usuario del token.
 */
taskRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');
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

  // Verificamos que la tarea pertenezca al usuario del token
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
    data: task
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

    const newTask: Task = {
      id: `task-${Date.now()}`,
      userId: currentUser.userId, // Siempre el usuario del token
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

    // Comprobamos propiedad estricta
    if (tasks[taskIndex].userId !== currentUser.userId) {
      return c.json(
        {
          success: false,
          message: 'Acceso denegado: No puedes modificar tareas que no te pertenecen.'
        },
        403
      );
    }

    const { title, description, completed } = c.req.valid('json');

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
 * Elimina una tarea solo si pertenece al usuario del token.
 */
taskRoutes.delete('/:id', (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');
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

  // Comprobamos propiedad estricta
  if (tasks[taskIndex].userId !== currentUser.userId) {
    return c.json(
      {
        success: false,
        message: 'Acceso denegado: No puedes eliminar tareas que no te pertenecen.'
      },
      403
    );
  }

  const deletedTask = tasks.splice(taskIndex, 1)[0];

  return c.json({
    success: true,
    message: 'Tarea eliminada correctamente.',
    data: deletedTask
  });
});

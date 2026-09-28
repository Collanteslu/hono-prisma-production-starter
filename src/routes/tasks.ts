import { Hono } from 'hono';
import { tasks, users } from '../db.js';
import { Task, AppEnv } from '../types/index.js';

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
 * Crea una nueva tarea asociada a un usuario.
 * Si no se especifica 'userId' en el cuerpo, se asocia automáticamente
 * al usuario autenticado en la sesión.
 */
taskRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { title, description, completed, userId } = body;
    const currentUser = c.get('user');

    // Determinamos qué usuario será el dueño de la tarea
    // Si se envía userId en el body, se utiliza ese; de lo contrario, el usuario en sesión
    const targetUserId = userId || currentUser?.userId;

    if (!title) {
      return c.json(
        {
          success: false,
          message: 'El título de la tarea es obligatorio.'
        },
        400
      );
    }

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
  } catch (error) {
    return c.json(
      {
        success: false,
        message: 'Cuerpo de la petición inválido.'
      },
      400
    );
  }
});

/**
 * PUT /api/tasks/:id
 * Actualiza una tarea existente (título, descripción, estado completado o usuario asignado).
 */
taskRoutes.put('/:id', async (c) => {
  try {
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

    const body = await c.req.json();
    const { title, description, completed, userId } = body;

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
    if (completed !== undefined) tasks[taskIndex].completed = Boolean(completed);

    return c.json({
      success: true,
      message: 'Tarea actualizada exitosamente.',
      data: tasks[taskIndex]
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        message: 'Error al actualizar la tarea.'
      },
      400
    );
  }
});

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

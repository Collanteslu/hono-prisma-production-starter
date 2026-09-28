import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { tasks, users } from '../db.js';
import { Task, AppEnv } from '../types/index.js';
import { createTaskSchema, updateTaskSchema } from '../schemas/index.js';

export const taskRoutes = new Hono<AppEnv>();

/**
 * GET /api/tasks
 * Lista de tareas con aislamiento de seguridad:
 * - Usuario estándar ('user'): SOLO ve sus propias tareas.
 * - Administrador ('admin'): Puede ver todas las tareas o filtrar por ?userId=...
 */
taskRoutes.get('/', (c) => {
  const currentUser = c.get('user');
  const queryUserId = c.req.query('userId');

  let resultTasks: Task[];

  if (currentUser.role === 'admin') {
    // El admin puede ver todas o filtrar opcionalmente por usuario
    resultTasks = queryUserId
      ? tasks.filter((t) => t.userId === queryUserId)
      : tasks;
  } else {
    // Seguridad: Un usuario normal solo recibe las tareas que le pertenecen
    resultTasks = tasks.filter((t) => t.userId === currentUser.userId);
  }

  return c.json({
    success: true,
    count: resultTasks.length,
    data: resultTasks
  });
});

/**
 * GET /api/tasks/:id
 * Obtiene el detalle de una tarea específica con control de acceso (ownership):
 * - Si la tarea no le pertenece al usuario (y no es admin), devuelve 403 Forbidden.
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

  // Comprobación de propiedad (Ownership Check)
  if (task.userId !== currentUser.userId && currentUser.role !== 'admin') {
    return c.json(
      {
        success: false,
        message: 'Acceso denegado: No tienes permiso para ver esta tarea porque pertenece a otro usuario.'
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
 * Crea una nueva tarea asociada a un usuario.
 * Seguridad:
 * - Usuario estándar: La tarea se asigna SIEMPRE a su propio userId extraído del token JWT.
 * - Admin: Puede asignar la tarea a cualquier userId que indique en el body.
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

    // Determinamos el usuario de forma segura
    let assignedUserId: string;

    if (currentUser.role === 'admin' && userId) {
      // El admin puede asignar a otro usuario; verificamos que ese usuario exista
      const userExists = users.some((u) => u.id === userId);
      if (!userExists) {
        return c.json(
          {
            success: false,
            message: `El usuario con id '${userId}' no existe.`
          },
          404
        );
      }
      assignedUserId = userId;
    } else {
      // Usuario regular: NUNCA se fía del body, se fuerza su propio userId autenticado
      assignedUserId = currentUser.userId;
    }

    const newTask: Task = {
      id: `task-${Date.now()}`,
      userId: assignedUserId,
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
 * Actualiza una tarea existente validando la propiedad de la misma.
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

    // Comprobación de permisos
    const currentTask = tasks[taskIndex];
    if (currentTask.userId !== currentUser.userId && currentUser.role !== 'admin') {
      return c.json(
        {
          success: false,
          message: 'Acceso denegado: No tienes permiso para editar tareas de otros usuarios.'
        },
        403
      );
    }

    const { title, description, completed, userId } = c.req.valid('json');

    // Solo un admin tiene permiso para reasignar tareas a otros usuarios
    if (userId) {
      if (currentUser.role !== 'admin') {
        return c.json(
          {
            success: false,
            message: 'Acceso denegado: Solo administradores pueden reasignar tareas.'
          },
          403
        );
      }
      const userExists = users.some((u) => u.id === userId);
      if (!userExists) {
        return c.json(
          {
            success: false,
            message: `El usuario con id '${userId}' no existe.`
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
 * Elimina una tarea solo si le pertenece al usuario actual (o si es admin).
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

  // Comprobación de permisos
  const currentTask = tasks[taskIndex];
  if (currentTask.userId !== currentUser.userId && currentUser.role !== 'admin') {
    return c.json(
      {
        success: false,
        message: 'Acceso denegado: No tienes permiso para eliminar tareas de otros usuarios.'
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

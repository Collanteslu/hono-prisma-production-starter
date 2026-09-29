/**
 * @file tasks.ts
 * @description Task management CRUD routes with strict user ownership and pagination.
 *
 * Security Model:
 * Standard users can ONLY read, create, update, and delete tasks they own.
 * Any attempt to access a task belonging to another user results in HTTP 403 Forbidden.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../db.js';
import { AppEnv, PaginationMeta } from '../types/index.js';
import { createTaskSchema, updateTaskSchema, taskQuerySchema } from '../schemas/index.js';

export const taskRoutes = new Hono<AppEnv>();

/**
 * GET /api/tasks
 * Lists tasks belonging exclusively to the authenticated user with pagination and filters.
 */
taskRoutes.get(
  '/',
  zValidator('query', taskQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: 'Invalid task query parameters',
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

    // Strict ownership filter: Always scope to the token's authenticated userId
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
 * Retrieves a single task ensuring strict ownership validation.
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
        message: `Task with ID '${id}' not found.`
      },
      404
    );
  }

  // Ownership verification
  if (task.userId !== currentUser.userId) {
    return c.json(
      {
        success: false,
        message: 'Access denied: You do not have permission to view this task.'
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
 * Creates a new task bound strictly to the authenticated user.
 */
taskRoutes.post(
  '/',
  zValidator('json', createTaskSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: 'Validation error when creating task',
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
        userId: currentUser.userId, // Secure assignment from verified token
        title,
        description: description || '',
        completed: Boolean(completed)
      }
    });

    return c.json(
      {
        success: true,
        message: 'Task created successfully.',
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
 * Updates task properties (title, description, completed) verifying ownership.
 */
taskRoutes.put(
  '/:id',
  zValidator('json', updateTaskSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: 'Validation error when updating task',
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
          message: `Task with ID '${id}' not found.`
        },
        404
      );
    }

    // Ownership verification
    if (existingTask.userId !== currentUser.userId) {
      return c.json(
        {
          success: false,
          message: 'Access denied: You cannot edit tasks belonging to other users.'
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
      message: 'Task updated successfully.',
      data: {
        ...updatedTask,
        createdAt: updatedTask.createdAt.toISOString()
      }
    });
  }
);

/**
 * DELETE /api/tasks/:id
 * Deletes a task ensuring ownership verification.
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
        message: `Task with ID '${id}' not found.`
      },
      404
    );
  }

  // Ownership verification
  if (existingTask.userId !== currentUser.userId) {
    return c.json(
      {
        success: false,
        message: 'Access denied: You cannot delete tasks belonging to other users.'
      },
      403
    );
  }

  const deletedTask = await prisma.task.delete({
    where: { id }
  });

  return c.json({
    success: true,
    message: 'Task deleted successfully.',
    data: {
      ...deletedTask,
      createdAt: deletedTask.createdAt.toISOString()
    }
  });
});

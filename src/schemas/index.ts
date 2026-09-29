import { z } from 'zod';

/**
 * Esquema de validación para el inicio de sesión.
 */
export const loginSchema = z.object({
  email: z
    .string({ required_error: 'El email es obligatorio' })
    .email({ message: 'El formato del correo electrónico no es válido' }),
  password: z
    .string({ required_error: 'La contraseña es obligatoria' })
    .min(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
});

/**
 * Esquema para renovar el Access Token con Refresh Token.
 */
export const refreshTokenSchema = z.object({
  refreshToken: z.string({ required_error: 'El refreshToken es obligatorio' })
});

/**
 * Esquema para cerrar sesión (Logout).
 */
export const logoutSchema = z.object({
  refreshToken: z.string({ required_error: 'El refreshToken es obligatorio para revocar la sesión' })
});

/**
 * Esquema para crear un nuevo usuario.
 */
export const createUserSchema = z.object({
  name: z
    .string({ required_error: 'El nombre es obligatorio' })
    .min(2, { message: 'El nombre debe tener al menos 2 caracteres' })
    .max(50, { message: 'El nombre no puede exceder 50 caracteres' }),
  email: z
    .string({ required_error: 'El email es obligatorio' })
    .email({ message: 'El formato de email no es válido' }),
  password: z
    .string({ required_error: 'La contraseña es obligatoria' })
    .min(6, { message: 'La contraseña debe tener mínimo 6 caracteres' }),
  role: z.enum(['admin', 'user']).optional().default('user')
});

/**
 * Esquema para actualizar un usuario existente.
 */
export const updateUserSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  email: z.string().email({ message: 'Formato de email inválido' }).optional(),
  password: z.string().min(6, { message: 'Mínimo 6 caracteres' }).optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Debes proporcionar al menos un campo para actualizar (name, email o password)'
});

/**
 * Esquema para crear una tarea.
 */
export const createTaskSchema = z.object({
  title: z
    .string({ required_error: 'El título es obligatorio' })
    .min(3, { message: 'El título debe tener al menos 3 caracteres' })
    .max(100, { message: 'El título no puede exceder 100 caracteres' }),
  description: z.string().optional().default(''),
  completed: z.boolean().optional().default(false)
});

/**
 * Esquema para actualizar una tarea existente.
 */
export const updateTaskSchema = z.object({
  title: z.string().min(3).max(100).optional(),
  description: z.string().optional(),
  completed: z.boolean().optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Debes proporcionar al menos un campo para actualizar (title, description o completed)'
});

/**
 * Esquema de consulta para tareas con paginación, filtros y búsqueda.
 */
export const taskQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  completed: z.enum(['true', 'false']).optional(),
  sortBy: z.enum(['createdAt', 'title']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc')
});

/**
 * Esquema de consulta para usuarios con paginación y búsqueda.
 */
export const userQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  role: z.enum(['admin', 'user']).optional(),
  sortBy: z.enum(['createdAt', 'name', 'email']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc')
});

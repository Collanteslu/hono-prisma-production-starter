import { z } from "zod";

/** Email normalizado (sin espacios y en minúsculas) para búsquedas y unicidad consistentes. */
const emailField = (requiredMessage: string, formatMessage: string) =>
  z
    .string({ required_error: requiredMessage })
    .trim()
    .toLowerCase()
    .email({ message: formatMessage });

/**
 * Política de contraseñas. bcrypt solo procesa los primeros 72 bytes, por lo que se limita la longitud.
 */
const passwordField = z
  .string({ required_error: "La contraseña es obligatoria" })
  .min(8, { message: "La contraseña debe tener al menos 8 caracteres" })
  .max(72, { message: "La contraseña no puede exceder 72 caracteres" });

const nameField = z
  .string({ required_error: "El nombre es obligatorio" })
  .trim()
  .min(2, { message: "El nombre debe tener al menos 2 caracteres" })
  .max(50, { message: "El nombre no puede exceder 50 caracteres" });

/**
 * Esquema de validación para el inicio de sesión.
 */
export const loginSchema = z.object({
  email: emailField("El email es obligatorio", "El formato del correo electrónico no es válido"),
  // No se aplica la política de contraseñas en el login para no bloquear cuentas existentes
  password: z
    .string({ required_error: "La contraseña es obligatoria" })
    .min(1, { message: "La contraseña es obligatoria" })
    .max(200),
});

/**
 * Esquema para el registro público de cuentas (siempre con rol "user").
 */
export const registerSchema = z.object({
  name: nameField,
  email: emailField("El email es obligatorio", "El formato de email no es válido"),
  password: passwordField,
});

/**
 * Esquema para renovar el Access Token con Refresh Token.
 */
export const refreshTokenSchema = z.object({
  refreshToken: z.string({ required_error: "El refreshToken es obligatorio" }).min(1).max(2048),
});

/**
 * Esquema para cerrar sesión (Logout).
 */
export const logoutSchema = z.object({
  refreshToken: z.string().max(2048).optional(),
});

/**
 * Esquema para bloquear o desbloquear un usuario.
 */
export const blockUserSchema = z.object({
  isBlocked: z.boolean({ required_error: "El campo isBlocked (true/false) es obligatorio" }),
  reason: z.string().max(255).optional(),
});

/**
 * Esquema para crear un nuevo usuario.
 */
export const createUserSchema = z.object({
  name: nameField,
  email: emailField("El email es obligatorio", "El formato de email no es válido"),
  password: passwordField,
  role: z.enum(["admin", "user"]).optional().default("user"),
});

/**
 * Esquema para actualizar un usuario existente.
 */
export const updateUserSchema = z
  .object({
    name: nameField.optional(),
    email: emailField("El email es obligatorio", "Formato de email inválido").optional(),
    password: passwordField.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debes proporcionar al menos un campo para actualizar (name, email o password)",
  });

/**
 * Esquema para crear una tarea.
 */
export const createTaskSchema = z.object({
  title: z
    .string({ required_error: "El título es obligatorio" })
    .min(3, { message: "El título debe tener al menos 3 caracteres" })
    .max(100, { message: "El título no puede exceder 100 caracteres" }),
  description: z
    .string()
    .max(2000, { message: "La descripción no puede exceder 2000 caracteres" })
    .optional()
    .default(""),
  completed: z.boolean().optional().default(false),
});

/**
 * Esquema para actualizar una tarea existente.
 */
export const updateTaskSchema = z
  .object({
    title: z.string().min(3).max(100).optional(),
    description: z.string().max(2000).optional(),
    completed: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message:
      "Debes proporcionar al menos un campo para actualizar (title, description o completed)",
  });

/**
 * Esquema de consulta para tareas con paginación, filtros y búsqueda.
 */
export const taskQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  completed: z.enum(["true", "false"]).optional(),
  sortBy: z.enum(["createdAt", "title"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  sort: z.string().optional(),
  include: z.string().optional(),
  includeDeleted: z.enum(["true", "false"]).optional(),
});

/**
 * Esquema de consulta para usuarios con paginación y búsqueda.
 */
export const userQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  role: z.enum(["admin", "user"]).optional(),
  isBlocked: z.enum(["true", "false"]).optional(),
  sortBy: z.enum(["createdAt", "name", "email"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  sort: z.string().optional(),
  include: z.string().optional(),
  includeDeleted: z.enum(["true", "false"]).optional(),
});

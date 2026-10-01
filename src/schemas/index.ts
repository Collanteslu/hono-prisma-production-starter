/**
 * @file index.ts
 * @description Zod request schemas. `.openapi("Name")` registers each schema as a reusable
 * OpenAPI component, so the published specification is always generated from the validators.
 */

import { z } from "@hono/zod-openapi";

/** Email normalizado (sin espacios y en minúsculas) para búsquedas y unicidad consistentes. */
const emailField = (formatMessage: string) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .email({ message: formatMessage })
    .openapi({ example: "ana@example.com" });

/**
 * Política de contraseñas. bcrypt solo procesa los primeros 72 BYTES (no caracteres): una clave con
 * tildes o emoji se truncaría en silencio, así que el límite real se comprueba en bytes UTF-8.
 */
const passwordField = z
  .string()
  .min(8, { message: "La contraseña debe tener al menos 8 caracteres" })
  .max(72, { message: "La contraseña no puede exceder 72 caracteres" })
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
    message:
      "La contraseña no puede exceder 72 bytes (los caracteres acentuados y emoji ocupan más de uno)",
  })
  .openapi({ example: "password123" });

const nameField = z
  .string()
  .trim()
  .min(2, { message: "El nombre debe tener al menos 2 caracteres" })
  .max(50, { message: "El nombre no puede exceder 50 caracteres" })
  .openapi({ example: "Ana García" });

/**
 * Esquema de validación para el inicio de sesión.
 */
export const loginSchema = z
  .object({
    email: emailField("El formato del correo electrónico no es válido"),
    // No se aplica la política de contraseñas en el login para no bloquear cuentas existentes
    password: z
      .string()
      .min(1, { message: "La contraseña es obligatoria" })
      .max(200)
      .openapi({ example: "password123" }),
  })
  .openapi("LoginRequest");

/**
 * Esquema para el registro público de cuentas (siempre con rol "user").
 */
export const registerSchema = z
  .object({
    name: nameField,
    email: emailField("El formato de email no es válido"),
    password: passwordField,
  })
  .openapi("RegisterRequest");

/**
 * Esquema para renovar el Access Token con Refresh Token.
 */
export const refreshTokenSchema = z
  .object({
    refreshToken: z.string().min(1).max(2048),
  })
  .openapi("RefreshTokenRequest");

/**
 * Esquema para cerrar sesión (Logout).
 */
export const logoutSchema = z
  .object({
    refreshToken: z.string().max(2048).optional(),
  })
  .openapi("LogoutRequest");

/**
 * Esquema para bloquear o desbloquear un usuario.
 */
export const blockUserSchema = z
  .object({
    isBlocked: z.boolean(),
    reason: z.string().max(255).optional().openapi({ example: "Violación de términos" }),
  })
  .openapi("BlockUserRequest");

/**
 * Esquema para cambiar el rol de un usuario.
 */
export const changeRoleSchema = z
  .object({
    role: z.enum(["admin", "user"]).openapi({ example: "admin" }),
  })
  .openapi("ChangeRoleRequest");

/**
 * Esquema para crear un nuevo usuario.
 */
export const createUserSchema = z
  .object({
    name: nameField,
    email: emailField("El formato de email no es válido"),
    password: passwordField,
    role: z.enum(["admin", "user"]).optional().default("user"),
  })
  .openapi("CreateUserRequest");

/**
 * Esquema para actualizar un usuario existente.
 */
export const updateUserSchema = z
  .object({
    name: nameField.optional(),
    email: emailField("Formato de email inválido").optional(),
    password: passwordField.optional(),
    currentPassword: z.string().min(1).max(200).optional().openapi({
      description:
        "Contraseña actual. Obligatoria al cambiar la propia contraseña; un admin que restablece la de otro usuario no la necesita.",
      example: "password123",
    }),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debes proporcionar al menos un campo para actualizar (name, email o password)",
  })
  .openapi("UpdateUserRequest");

/**
 * Esquema para crear una tarea.
 */
export const createTaskSchema = z
  .object({
    title: z
      .string()
      .min(3, { message: "El título debe tener al menos 3 caracteres" })
      .max(100, { message: "El título no puede exceder 100 caracteres" })
      .openapi({ example: "Diseñar interfaz frontend" }),
    description: z
      .string()
      .max(2000, { message: "La descripción no puede exceder 2000 caracteres" })
      .optional()
      .default(""),
    completed: z.boolean().optional().default(false),
  })
  .openapi("CreateTaskRequest");

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
  })
  .openapi("UpdateTaskRequest");

/** Parámetros de paginación compartidos por los listados */
const listParams = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
  sort: z.string().optional().openapi({
    description: "Orden multi-campo, p. ej. `-createdAt,title`",
    example: "-createdAt",
  }),
  include: z.string().optional().openapi({ description: "Relaciones separadas por comas" }),
  includeDeleted: z.enum(["true", "false"]).optional(),
};

/**
 * Esquema de consulta para tareas con paginación, filtros y búsqueda.
 * Los filtros dinámicos `filter[campo]` / `filter[campo][operador]` se leen directamente de la query.
 */
export const taskQuerySchema = z.object({
  ...listParams,
  completed: z.enum(["true", "false"]).optional(),
  sortBy: z.enum(["createdAt", "title"]).default("createdAt"),
});

/**
 * Esquema de consulta para usuarios con paginación y búsqueda.
 */
export const userQuerySchema = z.object({
  ...listParams,
  role: z.enum(["admin", "user"]).optional(),
  isBlocked: z.enum(["true", "false"]).optional(),
  sortBy: z.enum(["createdAt", "name", "email"]).default("createdAt"),
});

/** Parámetro de ruta `:id` */
export const idParamSchema = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "user-1" }),
});

/** Parámetro de ruta `:sessionId` */
export const sessionIdParamSchema = z.object({
  sessionId: z.string().openapi({ param: { name: "sessionId", in: "path" } }),
});

/** Opción `?permanent=true` para borrados físicos */
export const permanentQuerySchema = z.object({
  permanent: z.enum(["true", "false"]).optional().openapi({ description: "Borrado físico" }),
});

/** Query de `GET /tasks/:id` y `GET /users/:id` */
export const detailQuerySchema = z.object({
  include: z.string().optional().openapi({ description: "Relaciones separadas por comas" }),
  includeDeleted: z.enum(["true", "false"]).optional(),
});

/** Query de `GET /audit-logs` */
export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  entity: z.string().optional().openapi({ example: "Task" }),
  action: z.string().optional().openapi({ example: "SOFT_DELETE" }),
  userId: z.string().optional(),
});

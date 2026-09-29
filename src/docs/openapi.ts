/**
 * Especificación OpenAPI 3.0 completa de la API.
 * Describe esquemas, parámetros de consulta, códigos de respuesta y seguridad JWT.
 */
export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Hono REST API - Gestión de Usuarios y Tareas",
    version: "1.0.0",
    description:
      "API REST profesional construida con Hono, Prisma 7 (SQLite), TypeScript, Zod, Autenticación JWT con Refresh Tokens y Rate Limiting.",
  },
  servers: [
    {
      url: "http://localhost:3011",
      description: "Servidor Local de Desarrollo",
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Introduce tu Access Token JWT generado al iniciar sesión",
      },
    },
    schemas: {
      User: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string", example: "Ana García" },
          email: { type: "string", format: "email", example: "ana@example.com" },
          role: { type: "string", enum: ["admin", "user"], example: "user" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Task: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          userId: { type: "string", format: "uuid" },
          title: { type: "string", example: "Diseñar interfaz frontend" },
          description: { type: "string", example: "Crear vistas para consumir la API" },
          completed: { type: "boolean", example: false },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      PaginationMeta: {
        type: "object",
        properties: {
          total: { type: "integer", example: 42 },
          page: { type: "integer", example: 1 },
          limit: { type: "integer", example: 10 },
          totalPages: { type: "integer", example: 5 },
          hasNextPage: { type: "boolean", example: true },
          hasPrevPage: { type: "boolean", example: false },
        },
      },
      ResponseMeta: {
        type: "object",
        properties: {
          requestId: {
            type: "string",
            format: "uuid",
            example: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
          },
          timestamp: { type: "string", format: "date-time", example: "2026-09-29T22:00:00.000Z" },
          durationMs: {
            type: "number",
            example: 3.45,
            description: "Tiempo de procesamiento del servidor en ms",
          },
          apiVersion: { type: "string", example: "1.1.0" },
        },
      },
    },
  },
  paths: {
    "/healthz": {
      get: {
        summary: "Comprobación de salud (Healthcheck)",
        description: "Verifica la disponibilidad del servidor y la conexión activa a SQLite.",
        responses: {
          "200": { description: "Servidor y base de datos saludables" },
          "503": { description: "Fallo de conexión a la base de datos" },
        },
      },
    },
    "/api/auth/login": {
      post: {
        summary: "Inicio de sesión (Login)",
        description:
          "Autentica credenciales y emite Access Token (15 min) y Refresh Token (7 días). Protegido por Rate Limiter.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email", example: "admin@example.com" },
                  password: { type: "string", minLength: 6, example: "password123" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Login exitoso" },
          "400": { description: "Error de validación Zod" },
          "401": { description: "Credenciales inválidas" },
          "429": { description: "Rate limit excedido" },
        },
      },
    },
    "/api/auth/refresh": {
      post: {
        summary: "Renovar Access Token (Token Rotation)",
        description: "Intercambia un Refresh Token válido por un nuevo par de tokens.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["refreshToken"],
                properties: {
                  refreshToken: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Tokens renovados" },
          "401": { description: "Refresh token expirado o revocado" },
        },
      },
    },
    "/api/auth/logout": {
      post: {
        summary: "Cierre de sesión (Logout)",
        description: "Revoca el refresh token en la base de datos invalidando la sesión.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["refreshToken"],
                properties: {
                  refreshToken: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Sesión revocada" },
        },
      },
    },
    "/api/sessions/me": {
      get: {
        summary: "Listar sesiones activas del usuario actual",
        description:
          "Devuelve todos los dispositivos y sesiones abiertas por el usuario autenticado.",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "Lista de sesiones del usuario" },
        },
      },
    },
    "/api/sessions/{sessionId}": {
      delete: {
        summary: "Revocar sesión específica",
        description: "Cierra la sesión indicada de forma inmediata. Solo el dueño o Admin.",
        security: [{ BearerAuth: [] }],
        parameters: [{ name: "sessionId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Sesión revocada" },
          "403": { description: "No te pertenece" },
          "404": { description: "Sesión no encontrada" },
        },
      },
    },
    "/api/sessions/revoke-all": {
      post: {
        summary: "Revocar todas las sesiones del usuario",
        description:
          "Invalida todas las sesiones y refresh tokens del usuario en todos los dispositivos.",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "Todas las sesiones han sido revocadas" },
        },
      },
    },
    "/api/users": {
      get: {
        summary: "Listar usuarios (Solo Admin, Paginado)",
        description:
          "Lista las cuentas de usuario registradas con sus emails y roles. Requiere rol de administrador.",
        security: [{ BearerAuth: [] }],

        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "role", in: "query", schema: { type: "string", enum: ["admin", "user"] } },
          {
            name: "includeDeleted",
            in: "query",
            description: "Incluir cuentas borradas lógicamente (soft-delete)",
            schema: { type: "string", enum: ["true", "false"], default: "false" },
          },
          {
            name: "sort",
            in: "query",
            description: "Ordenación multidireccional (ej. -createdAt,name)",
            schema: { type: "string", example: "-createdAt" },
          },
          {
            name: "include",
            in: "query",
            description: "Expansión relacional separada por comas (ej. tasks,sessions)",
            schema: { type: "string", example: "tasks,sessions" },
          },
        ],
        responses: {
          "200": { description: "Lista paginada de usuarios" },
        },
      },
      post: {
        summary: "Crear usuario",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "email", "password"],
                properties: {
                  name: { type: "string", example: "Carlos López" },
                  email: { type: "string", format: "email", example: "carlos@example.com" },
                  password: { type: "string", minLength: 6, example: "secret123" },
                  role: { type: "string", enum: ["admin", "user"], default: "user" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Usuario creado" },
          "409": { description: "Email duplicado" },
        },
      },
    },
    "/api/users/{id}": {
      get: {
        summary: "Obtener usuario por ID",
        description:
          "Permite inspeccionar el perfil de un usuario con expansión relacional de sus tareas y sesiones.",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          {
            name: "include",
            in: "query",
            description: "Expansión relacional (ej. tasks,sessions)",
            schema: { type: "string", example: "tasks" },
          },
        ],
        responses: {
          "200": { description: "Perfil del usuario recuperado" },
          "404": { description: "Usuario no encontrado" },
        },
      },
      put: {
        summary: "Actualizar perfil de usuario",
        description:
          "Permite modificar nombre, email o contraseña. Solo el propio usuario o Admin.",
        security: [{ BearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string", example: "Nuevo Nombre" },
                  email: { type: "string", format: "email" },
                  password: { type: "string", minLength: 6 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Perfil actualizado" },
          "403": { description: "No tienes permiso para modificar este usuario" },
          "404": { description: "Usuario no encontrado" },
        },
      },
      delete: {
        summary: "Eliminar usuario (Soft-Delete por defecto)",
        description:
          "Aplica borrado lógico revocando todas sus sesiones activas. Si se especifica ?permanent=true, se elimina físicamente.",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          {
            name: "permanent",
            in: "query",
            description: "Borrado físico definitivo",
            schema: { type: "string", enum: ["true", "false"], default: "false" },
          },
        ],
        responses: {
          "200": { description: "Usuario soft-deleted o eliminado permanentemente" },
          "404": { description: "Usuario no encontrado" },
        },
      },
    },
    "/api/users/{id}/block": {
      patch: {
        summary: "Suspender o reactivar usuario (Solo Admin)",
        description:
          "Bloquea o desbloquea una cuenta. Al bloquearla, revoca inmediatamente todas sus sesiones activas.",
        security: [{ BearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["isBlocked"],
                properties: {
                  isBlocked: { type: "boolean" },
                  reason: { type: "string", example: "Violación de términos del servicio" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Estado de la cuenta actualizado" },
          "403": { description: "Solo accesible para administradores" },
        },
      },
    },
    "/api/users/{id}/revoke-sessions": {
      post: {
        summary: "Revocar todas las sesiones de un usuario",
        description:
          "Cierra todas las sesiones activas de un usuario objetivo. Solo el usuario dueño o Admin.",
        security: [{ BearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Sesiones revocadas" },
          "403": { description: "No autorizado" },
        },
      },
    },

    "/api/tasks": {
      get: {
        summary: "Listar tareas del usuario autenticado (Paginado, Filtros y Soft Delete)",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "completed", in: "query", schema: { type: "string", enum: ["true", "false"] } },
          {
            name: "includeDeleted",
            in: "query",
            description: "Incluir tareas marcadas con borrado lógico (soft-deleted)",
            schema: { type: "string", enum: ["true", "false"], default: "false" },
          },
          {
            name: "sort",
            in: "query",
            description: "Ordenación multidireccional (ej. -createdAt,title)",
            schema: { type: "string", example: "-createdAt" },
          },
          {
            name: "include",
            in: "query",
            description: "Expansión relacional (ej. user para incrustar datos del autor)",
            schema: { type: "string", example: "user" },
          },
        ],
        responses: {
          "200": { description: "Lista de tareas del usuario" },
        },
      },
      post: {
        summary: "Crear tarea",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title"],
                properties: {
                  title: { type: "string", example: "Estudiar Hono con OpenAPI" },
                  description: { type: "string", example: "Probar documentación interactiva" },
                  completed: { type: "boolean", default: false },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Tarea creada" },
        },
      },
    },
    "/api/tasks/{id}": {
      get: {
        summary: "Ver tarea por ID (Solo el dueño)",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          {
            name: "include",
            in: "query",
            description: "Expansión relacional (ej. user)",
            schema: { type: "string", example: "user" },
          },
        ],
        responses: {
          "200": { description: "Detalle de la tarea" },
          "403": { description: "No te pertenece" },
          "404": { description: "No encontrada" },
        },
      },
      put: {
        summary: "Actualizar tarea (Solo el dueño)",
        security: [{ BearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  completed: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Tarea actualizada" },
          "403": { description: "No te pertenece" },
        },
      },
      delete: {
        summary: "Eliminar tarea (Soft Delete por defecto, solo el dueño)",
        description:
          "Marca deletedAt por defecto. Si se pasa ?permanent=true, elimina la tarea físicamente de la base de datos.",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          {
            name: "permanent",
            in: "query",
            description: "Borrado físico permanente",
            schema: { type: "string", enum: ["true", "false"], default: "false" },
          },
        ],
        responses: {
          "200": { description: "Tarea soft-deleted o permanentemente eliminada" },
          "403": { description: "No te pertenece" },
        },
      },
    },
    "/api/audit-logs": {
      get: {
        summary: "Consultar registros de auditoría y trazabilidad (Solo Admin)",
        description:
          "Permite auditar mutaciones del sistema (CREATE, UPDATE, SOFT_DELETE, DELETE_PERMANENT, BLOCK).",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          {
            name: "entity",
            in: "query",
            description: "Filtrar por entidad (Task, User)",
            schema: { type: "string" },
          },
          {
            name: "action",
            in: "query",
            description: "Filtrar por tipo de acción",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "Lista de eventos de auditoría" },
          "403": { description: "Acceso exclusivo para administradores" },
        },
      },
    },
  },
};

# API REST con Hono, TypeScript, Autenticación JWT y Validación Zod

Esta es una API REST profesional construida con **[Hono](https://hono.dev/)**, **TypeScript**, **JWT** y **[Zod](https://zod.dev/)** ejecutándose sobre **Node.js** con `@hono/node-server`.

---

## Características Principales

- **Validación Estricta con Zod y `@hono/zod-validator`**: Todos los payloads (login, crear/actualizar usuario, crear/actualizar tarea) pasan por esquemas de Zod antes de llegar a los controladores.
- **Autenticación con JWT (`hono/jwt`)**: Emisión de tokens firmados con `HS256`, expiración y verificación mediante middleware nativo.
- **CRUD completo de Usuarios**: Crear, listar, consultar por ID, actualizar y borrar.
- **CRUD completo de Tareas asociadas a Usuarios**: Crear tareas asignadas a un usuario, listar (con filtro por usuario `?userId=`), actualizar estado y eliminar.
- **Eliminación en cascada**: Al borrar un usuario, se eliminan automáticamente todas sus tareas asociadas.
- **Tipado estricto extremo con TypeScript**: Integración de esquemas Zod con `c.req.valid('json')` y contexto tipado con `AppEnv`.

---

## Estructura del Proyecto

```text
hono-test/
├── package.json          # Dependencias (hono, zod, @hono/zod-validator, tsx, typescript)
├── tsconfig.json          # Configuración de TypeScript (ESNext / NodeNext)
├── test-api.sh           # Script de pruebas automatizadas con curl
├── README.md             # Documentación detallada
└── src/
    ├── index.ts          # Servidor principal y middlewares globales (logger, cors, prettyJSON)
    ├── db.ts             # Base de datos simulada en memoria
    ├── types/
    │   └── index.ts      # Modelos TypeScript e interfaces de la aplicación
    ├── schemas/
    │   └── index.ts      # Esquemas de validación Zod (login, usuarios, tareas)
    ├── middleware/
    │   └── auth.ts       # Middleware de autenticación JWT (Bearer Token)
    └── routes/
        ├── auth.ts       # Endpoint POST /api/auth/login validado con Zod
        ├── users.ts      # Endpoints CRUD de usuarios validados con Zod
        └── tasks.ts      # Endpoints CRUD de tareas validados con Zod
```

---

## 1. Requisitos Previos

- **Node.js** (v18.14.0 o superior, probado con v24)
- **npm** (v9 o superior)

---

## 2. Puesta en Marcha

### Iniciar en modo desarrollo (Hot-reload)
```bash
npm run dev
```

El servidor estará escuchando en:
```text
http://localhost:3000
```

---

## 3. Esquemas de Validación (Zod)

Los esquemas residen en `src/schemas/index.ts`:

1. **`loginSchema`**:
   - `email`: Formato email válido y obligatorio.
   - `password`: Mínimo 6 caracteres.

2. **`createUserSchema`**:
   - `name`: String de entre 2 y 50 caracteres.
   - `email`: Formato email válido.
   - `password`: Mínimo 6 caracteres.
   - `role`: `'admin'` o `'user'` (opcional, default: `'user'`).

3. **`updateUserSchema`**:
   - Campos `name`, `email`, `password` opcionales, pero exige enviar al menos uno.

4. **`createTaskSchema`**:
   - `title`: String de 3 a 100 caracteres.
   - `description`: Opcional.
   - `completed`: Booleano opcional (default: `false`).
   - `userId`: Opcional (si no se especifica, toma el ID del usuario autenticado).

5. **`updateTaskSchema`**:
   - Actualización parcial de `title`, `description`, `completed` o reasignación de `userId`.

---

## 4. Endpoints y Ejemplos con `curl`

###  Autenticación

#### Iniciar Sesión (Login)
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com", "password":"password123"}'
```

*Ejemplo de respuesta con error de validación Zod si envías datos incorrectos:*
```json
{
  "success": false,
  "message": "Error de validación en los datos de entrada",
  "errors": {
    "email": ["El formato del correo electrónico no es válido"],
    "password": ["La contraseña debe tener al menos 6 caracteres"]
  }
}
```

---

###  Usuarios (`/api/users`)
*Requiere `Authorization: Bearer <TOKEN>`*

- `GET /api/users` - Lista todos los usuarios.
- `GET /api/users/:id` - Detalle de un usuario.
- `POST /api/users` - Crear usuario (validado con `createUserSchema`).
- `PUT /api/users/:id` - Actualizar usuario (validado con `updateUserSchema`).
- `DELETE /api/users/:id` - Eliminar usuario y sus tareas en cascada.

```bash
# Crear Usuario
curl -X POST http://localhost:3000/api/users \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Carlos Lopez",
    "email": "carlos@example.com",
    "password": "password123",
    "role": "user"
  }'
```

---

### 📋 Tareas (`/api/tasks`)
*Requiere `Authorization: Bearer <TOKEN>`*

- `GET /api/tasks` - Lista todas las tareas (soporta `?userId=<id>`).
- `GET /api/tasks/:id` - Detalle de una tarea.
- `POST /api/tasks` - Crear tarea asociada a un usuario (validado con `createTaskSchema`).
- `PUT /api/tasks/:id` - Actualizar tarea (validado con `updateTaskSchema`).
- `DELETE /api/tasks/:id` - Eliminar tarea.

```bash
# Crear Tarea para un usuario
curl -X POST http://localhost:3000/api/tasks \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Aprender Hono con Zod y JWT",
    "description": "Completar la validación y pruebas de la API",
    "userId": "user-1",
    "completed": false
  }'
```

---

## 5. Pruebas Automatizadas

Ejecuta el script de prueba integrado que comprueba todo el flujo de inicio a fin:

```bash
./test-api.sh
```

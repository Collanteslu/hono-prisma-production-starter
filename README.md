# API REST con Hono, TypeScript, Autenticación JWT, Usuarios y Tareas

Esta es una API REST construida con **[Hono](https://hono.dev/)** y **TypeScript** ejecutándose sobre **Node.js** con `@hono/node-server`.

Incluye:
- **Autenticación con JWT**: Rutas públicas y privadas mediante middleware.
- **CRUD completo de Usuarios**: Crear, listar, consultar por ID, actualizar y borrar.
- **CRUD completo de Tareas asociadas a Usuarios**: Crear tareas para un usuario, listar (con filtro por usuario `?userId=`), actualizar estado y eliminar.
- **Eliminación en cascada**: Al eliminar un usuario, se eliminan automáticamente todas sus tareas asociadas.
- **Arquitectura limpia y modular**: Middlewares, rutas modulares, tipado estricto con TypeScript y base de datos en memoria para pruebas instantáneas.

---

## Estructura del Proyecto

```text
hono-test/
├── package.json          # Dependencias y scripts
├── tsconfig.json          # Configuración de TypeScript (ESNext / NodeNext)
├── test-api.sh           # Script de pruebas automatizadas con curl
├── README.md             # Esta guía detallada
└── src/
    ├── index.ts          # Servidor principal y middlewares globales
    ├── db.ts             # Base de datos simulada en memoria
    ├── types/
    │   └── index.ts      # Modelos de TypeScript (User, Task, JwtPayload, AppEnv)
    ├── middleware/
    │   └── auth.ts       # Middleware de validación JWT (Bearer Token)
    └── routes/
        ├── auth.ts       # Endpoint POST /api/auth/login
        ├── users.ts      # Endpoints CRUD de usuarios (/api/users)
        └── tasks.ts      # Endpoints CRUD de tareas (/api/tasks)
```

---

## 1. Requisitos Previos

- **Node.js** (v18.14.0 o superior, probado con v24)
- **npm** (v9 o superior)

---

## 2. Instalación y Puesta en Marcha

### Instalar dependencias (si partes de cero)
```bash
npm install
```

### Iniciar en modo desarrollo (Hot-reload con `tsx`)
```bash
npm run dev
```

El servidor estará escuchando en:
```text
http://localhost:3000
```

---

## 3. Datos de Prueba Preexistentes

Para probar inmediatamente sin necesidad de registrar datos manualmente, la base de datos en memoria incluye:

- **Usuario Admin:**
  - **Email:** `admin@example.com`
  - **Password:** `password123`
  - **ID:** `user-1`
- **Usuario Regular:**
  - **Email:** `ana@example.com`
  - **Password:** `password123`
  - **ID:** `user-2`

---

## 4. Endpoints de la API

###  Autenticación

| Método | Endpoint | Descripción | Requiere Token |
|---|---|---|---|
| `POST` | `/api/auth/login` | Inicia sesión y genera el JWT | No |

**Ejemplo de Petición Login:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com", "password":"password123"}'
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Inicio de sesión exitoso",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "user-1",
    "name": "Luis Admin",
    "email": "admin@example.com",
    "role": "admin"
  }
}
```

---

###  Usuarios (`/api/users`)
*Todos estos endpoints requieren la cabecera: `Authorization: Bearer <TOKEN>`*

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/users` | Listar todos los usuarios |
| `GET` | `/api/users/:id` | Ver un usuario específico |
| `POST` | `/api/users` | Crear un nuevo usuario |
| `PUT` | `/api/users/:id` | Actualizar nombre, email o contraseña |
| `DELETE` | `/api/users/:id` | Eliminar usuario y sus tareas (en cascada) |

#### Crear Usuario
```bash
curl -X POST http://localhost:3000/api/users \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Carlos Lopez",
    "email": "carlos@example.com",
    "password": "pass123Segura",
    "role": "user"
  }'
```

#### Actualizar Usuario
```bash
curl -X PUT http://localhost:3000/api/users/<USER_ID> \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Carlos López Modificado"}'
```

#### Eliminar Usuario
```bash
curl -X DELETE http://localhost:3000/api/users/<USER_ID> \
  -H "Authorization: Bearer <TOKEN>"
```

---

### 📋 Tareas (`/api/tasks`)
*Todos estos endpoints requieren la cabecera: `Authorization: Bearer <TOKEN>`*

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/tasks` | Listar todas las tareas (o filtrar con `?userId=<id>`) |
| `GET` | `/api/tasks/:id` | Ver una tarea específica |
| `POST` | `/api/tasks` | Crear una nueva tarea asignada a un usuario |
| `PUT` | `/api/tasks/:id` | Actualizar título, descripción, completada o reasignar |
| `DELETE` | `/api/tasks/:id` | Eliminar una tarea |

#### Crear Tarea para un Usuario
> Si no pasas `userId`, se asignará automáticamente al usuario dueño del token.
```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Aprender Hono y TypeScript",
    "description": "Completar la guía y revisar el código de rutas",
    "userId": "user-1",
    "completed": false
  }'
```

#### Listar Tareas de un Usuario Específico
```bash
curl -X GET "http://localhost:3000/api/tasks?userId=user-1" \
  -H "Authorization: Bearer <TOKEN>"
```

#### Actualizar Tarea (Marcar como completada)
```bash
curl -X PUT http://localhost:3000/api/tasks/<TASK_ID> \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"completed": true}'
```

---

## 5. Pruebas Automatizadas en un Solo Paso

Se incluye el script ejecutable `test-api.sh` que prueba todo el ciclo de vida (login, tokens, CRUD de usuarios y tareas, filtros y borrado en cascada):

1. Asegúrate de tener el servidor corriendo (`npm run dev`).
2. En otra terminal ejecuta:
```bash
./test-api.sh
```

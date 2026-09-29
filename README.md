# API REST Profesional con Hono, Prisma 7, SQLite, JWT y Zod

API REST de nivel de producción construida con **[Hono](https://hono.dev/)**, **Prisma 7** (con SQLite local), **TypeScript**, **Zod**, **Bcrypt**, **Refresh Tokens con Token Rotation**, **Rate Limiting** y documentación interactiva **OpenAPI (Scalar)**.

---

## Características de Nivel de Producción

1. **Autenticación Robusta**:
   - **Hasheo Bcrypt**: Las contraseñas nunca se guardan en texto plano (`SALT_ROUNDS = 10`).
   - **Access Token (15 min)**: Token JWT de corta vida para mitigar ventanas de vulnerabilidad.
   - **Refresh Token (7 días)**: Almacenado en SQLite (`RefreshToken`).
   - **Token Rotation**: Cada vez que se usa un refresh token, este se invalida y se emite uno nuevo.
   - **Logout Real**: Revoca de inmediato la sesión en la base de datos.
2. **Seguridad y Trazabilidad**:
   - **Rate Limiting**: Mitiga ataques de fuerza bruta en `/api/auth/login` (cabeceras `X-RateLimit-*` y HTTP `429`).
   - **Request ID (`X-Request-Id`)**: Inyección de UUID v4 en cada petición para trazabilidad en logs.
   - **Cabeceras Seguras HTTP**: `secureHeaders()` de Hono (HSTS, CSP, XSS protection, anti-clickjacking, no-sniff).
   - **Aislamiento Estricto (Ownership)**: Un usuario estándar solo puede ver, crear, actualizar o borrar sus propias tareas.
3. **Paginación, Búsqueda y Ordenación**:
   - Parámetros: `?page=1&limit=10&search=...&completed=true&sortBy=createdAt&order=desc`.
   - Respuestas enriquecidas con metadatos: `{ total, page, limit, totalPages, hasNextPage, hasPrevPage }`.
4. **Validación de Entorno y Datos (Zod)**:
   - Configuración en `.env` validada al arrancar (`src/config/env.ts`).
   - Todos los bodies y query params validados estrictamente con `@hono/zod-validator`.
5. **Observabilidad y Documentación**:
   - **Documentación Interactiva**: Disponible en `http://localhost:3011/docs` impulsada por **Scalar**.
   - **Healthcheck Profundo**: Endpoint `/healthz` con verificación activa de latencia a SQLite y uptime.
6. **Persistencia con Prisma 7**:
   - SQLite local (`dev.db`) con relaciones `User` 1:N `Task` y borrado en cascada (`onDelete: Cascade`).

---

## Estructura del Código

```text
hono-test/
├── .env                  # Variables locales (PORT=3011, JWT_SECRET, etc.)
├── .env.example          # Plantilla para despliegues
├── prisma.config.ts      # Configuración de Prisma 7
├── prisma/
│   └── schema.prisma     # Modelos User, Task y RefreshToken
├── bruno/                # Colección completa para Bruno API Client
│   ├── Auth/             # Login Admin, Login User, Refresh Token, Logout
│   ├── Users/            # List Users (paginado), CRUD completo
│   ├── Tasks/            # List Tasks (paginado/búsqueda), CRUD completo
│   └── environments/     # Variables Local (baseUrl, tokens)
├── src/
│   ├── config/
│   │   └── env.ts        # Validación de variables de entorno con Zod
│   ├── db.ts             # Cliente Prisma 7 (libsql adapter) y seed inicial
│   ├── docs/
│   │   └── openapi.ts    # Especificación OpenAPI 3.0 completa
│   ├── middleware/
│   │   ├── auth.ts       # Validación JWT Bearer
│   │   ├── rateLimit.ts  # Limitador de peticiones por IP
│   │   └── requestId.ts  # Trazabilidad X-Request-Id
│   ├── routes/
│   │   ├── auth.ts       # /api/auth (login, refresh, logout)
│   │   ├── users.ts      # /api/users (CRUD paginado)
│   │   └── tasks.ts      # /api/tasks (CRUD paginado y filtrado)
│   ├── schemas/
│   │   └── index.ts      # Esquemas Zod para bodies y query params
│   ├── types/
│   │   └── index.ts      # Tipos e interfaces TypeScript
│   ├── utils/
│   │   └── password.ts   # Hasheo y verificación bcrypt
│   └── index.ts          # Servidor principal, middlewares globales y /docs
├── test-api.sh           # Test suite automatizado de extremo a extremo
└── README.md
```

---

## 🚀 Puesta en Marcha

### 1. Iniciar el servidor
```bash
npm run dev
```
El servidor arrancará en:
```text
http://localhost:3011
```

### 2. Documentación interactiva
Abre en tu navegador:
```text
http://localhost:3011/docs
```

### 3. Comprobar salud del servidor
```bash
curl -s http://localhost:3011/healthz
```

### 4. Ejecutar todas las pruebas automáticas
```bash
./test-api.sh
```

---

## 👥 Credenciales de Prueba (Base de datos SQLite)

| Usuario | Email | Contraseña | Rol |
|---|---|---|---|
| **Admin** | `admin@example.com` | `password123` | `admin` |
| **User** | `ana@example.com` | `password123` | `user` |

---

## 📡 Endpoints Principales

### Autenticación (`/api/auth`)
- `POST /api/auth/login` - Obtiene `accessToken` (15 min) y `refreshToken` (7 días).
- `POST /api/auth/refresh` - Renueva tokens mediante Token Rotation.
- `POST /api/auth/logout` - Revoca la sesión en la base de datos.

### Tareas (`/api/tasks`) *(Requiere Bearer Token)*
- `GET /api/tasks?page=1&limit=10&search=frontend&completed=true` - Lista paginada y filtrada.
- `GET /api/tasks/:id` - Ver tarea (solo dueño).
- `POST /api/tasks` - Crear tarea (asignada automáticamente al usuario del token).
- `PUT /api/tasks/:id` - Actualizar tarea propia.
- `DELETE /api/tasks/:id` - Borrar tarea propia.

### Usuarios (`/api/users`) *(Requiere Bearer Token)*
- `GET /api/users?page=1&limit=10&search=ana` - Lista paginada de usuarios.
- `GET /api/users/:id` - Ver usuario.
- `POST /api/users` - Crear usuario (contraseña hasheada con bcrypt).
- `PUT /api/users/:id` - Actualizar usuario.
- `DELETE /api/users/:id` - Borrar usuario (borra en cascada sus tareas y tokens).

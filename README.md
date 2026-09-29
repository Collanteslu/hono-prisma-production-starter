#  API REST Profesional: Hono, Prisma 7, SQLite, Zod & JWT

> **API REST moderna y robusta de nivel de producción** construida con **TypeScript** sobre el framework ultrarrápido **[Hono](https://hono.dev/)**, persistencia con **[Prisma 7](https://www.prisma.io/)** (utilizando SQLite local), validación con **[Zod](https://zod.dev/)**, hasheo con **[Bcrypt](https://github.com/dcodeIO/bcrypt.js)**, **Sesiones Stateful con control de expulsión y bloqueo en tiempo real**, **Rate Limiting** y documentación interactiva generada con **[Scalar OpenAPI](https://scalar.com/)**.

---

## 📑 Tabla de Contenidos
1. [Características Principales](#-características-principales)
2. [Arquitectura y Estructura del Código](#-arquitectura-y-estructura-del-código)
3. [Requisitos y Puesta en Marcha](#-requisitos-y-puesta-en-marcha)
4. [Documentación Interactiva (Scalar OpenAPI)](#-documentación-interactiva-scalar-openapi)
5. [Pruebas con Bruno API Client](#-pruebas-con-bruno-api-client)
6. [Seguridad y Gestión de Sesiones](#-seguridad-y-gestión-de-sesiones)
7. [Referencia de Endpoints](#-referencia-de-endpoints)
8. [Pruebas Automatizadas](#-pruebas-automatizadas)

---

## 🚀 Características Principales

- ⚡ **Rendimiento de Próxima Generación**: Desarrollada sobre **Hono** con `@hono/node-server`.
- 🗄️ **Persistencia con Prisma 7 & Driver Adapters**: Motor SQLite local (`dev.db`) con `@prisma/adapter-libsql` de alto rendimiento, migraciones limpias y borrado en cascada (`onDelete: Cascade`).
- 🔐 **Autenticación Híbrida & Stateful Sessions**:
  - **Access Token (15 min)**: JWT firmado con `HS256`.
  - **Refresh Token (7 días)**: Con **Token Rotation** (un solo uso por token).
  - **Persistencia de Sesiones**: Registro en SQLite de IP, User-Agent y estado activo (`isActive`).
  - **Expulsión Inmediata y Bloqueo**: Un administrador puede suspender a un usuario o tirar una sesión específica; la invalidación ocurre **en tiempo real** sin esperar a que expire el JWT.
  - **Hasheo Seguro**: Contraseñas cifradas con `bcryptjs` (10 rondas de salt).
- 🛡️ **Defensa en Profundidad**:
  - **Rate Limiting**: Mitigación de ataques de fuerza bruta en `/api/auth/login` (10 req/min por IP con cabeceras `X-RateLimit-*`).
  - **Secure Headers**: Protección nativa contra XSS, Clickjacking, MIME-sniffing y política HSTS.
  - **Trazabilidad (Request ID)**: Inyección automática de `X-Request-Id` (UUID v4) en cada petición.
  - **Control de Pertenencia (Ownership)**: Un usuario estándar solo puede consultar, editar o borrar sus propias tareas.
- 📋 **Paginación, Filtros y Búsqueda**: Parámetros tipados (`page`, `limit`, `search`, `completed`, `order`) con metadatos de respuesta (`totalPages`, `total`, `hasNextPage`).
- 🩺 **Observabilidad**: Endpoint `/healthz` con diagnóstico profundo y medición en milisegundos de la latencia hacia SQLite.

---

## 🏗️ Arquitectura y Estructura del Código

```text
hono-test/
├── .env                              # Configuración local (puerto 3011, secretos)
├── .env.example                      # Plantilla para entornos de producción
├── prisma.config.ts                  # Configuración de Prisma 7
├── prisma/
│   └── schema.prisma                 # Modelos: User, Session, RefreshToken y Task
├── bruno/                            # Colección lista para Bruno API Client
│   ├── bruno.json                    # Manifiesto de la colección
│   ├── collection.bru                # Header global Authorization Bearer
│   ├── environments/                 # Variables de entorno (Local.bru)
│   ├── Auth/                         # Login Admin, Login User, Refresh, Logout
│   ├── Sessions/                     # Listar mis sesiones, tirar sesión, tirar todas
│   ├── Users/                        # CRUD paginado, Bloquear/Desbloquear usuario
│   └── Tasks/                        # CRUD paginado y filtrado de tareas
├── src/
│   ├── config/
│   │   └── env.ts                    # Validación de variables de entorno con Zod
│   ├── db.ts                         # Cliente Prisma 7 (libsql) y seeder inicial
│   ├── docs/
│   │   └── openapi.ts                # Especificación OpenAPI 3.0 completa
│   ├── middleware/
│   │   ├── auth.ts                   # Stateful Session Check & Bloqueo en tiempo real
│   │   ├── rateLimit.ts              # Limitador de peticiones por IP
│   │   └── requestId.ts              # Inyección y propagación de X-Request-Id
│   ├── routes/
│   │   ├── auth.ts                   # /api/auth (Login, Refresh, Logout)
│   │   ├── sessions.ts               # /api/sessions (Gestión de sesiones activas)
│   │   ├── users.ts                  # /api/users (CRUD de usuarios y bloqueo)
│   │   └── tasks.ts                  # /api/tasks (CRUD de tareas con ownership)
│   ├── schemas/
│   │   └── index.ts                  # Esquemas Zod para bodies y query params
│   ├── types/
│   │   └── index.ts                  # Definiciones de tipos e interfaces TypeScript
│   ├── utils/
│   │   └── password.ts               # Hasheo y verificación segura con Bcrypt
│   └── index.ts                      # Punto de entrada principal y middlewares globales
├── test-api.sh                       # Suite de pruebas automatizadas con curl
└── README.md
```

---

## ⚙️ Requisitos y Puesta en Marcha

### Requisitos Previos
- **Node.js** (v18.14.0 o superior, probado en Node v24).
- **npm** (v9 o superior).

### 1. Clonar e Instalar Dependencias
```bash
git clone <url-del-repositorio>
cd hono-test
npm install
```

### 2. Variables de Entorno
Copia la plantilla de variables de entorno:
```bash
cp .env.example .env
```
*(El archivo `.env` ya viene preconfigurado con el puerto `3011` y secretos seguros).*

### 3. Sincronizar Base de Datos SQLite
```bash
npx prisma db push
```

### 4. Iniciar el Servidor en Desarrollo
```bash
npm run dev
```

El servidor estará escuchando en:
```text
http://localhost:3011
```

*(En el primer arranque, `seedDatabase()` poblará automáticamente la base de datos con usuarios y tareas de prueba con contraseñas hasheadas).*

---

## 📖 Documentación Interactiva (Scalar OpenAPI)

La API cuenta con una interfaz gráfica interactiva moderna para explorar y probar endpoints directamente desde el navegador, generada mediante **[Scalar](https://scalar.com/)**:

- **URL de la Documentación:** [http://localhost:3011/docs](http://localhost:3011/docs)
- **Especificación OpenAPI (JSON):** [http://localhost:3011/openapi.json](http://localhost:3011/openapi.json)

Desde esta consola web puedes:
1. Probar cualquier llamada HTTP (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`).
2. Configurar el botón **Authorize** pegando tu token JWT para probar endpoints privados.
3. Inspeccionar esquemas de datos, validaciones y códigos de estado HTTP.

---

## 🐶 Pruebas con Bruno API Client

### ¿Qué es Bruno?
**[Bruno](https://www.usebruno.com/)** es un cliente API de código abierto, rápido y moderno, diseñado como una alternativa ligera y privada a herramientas como Postman o Insomnia. 

A diferencia de Postman:
- Guarda las colecciones como archivos de texto plano legibles (`.bru`) directamente dentro del repositorio del proyecto.
- No almacena tus datos en la nube ni requiere crear una cuenta obligatoria.
- Permite versionar peticiones, headers y scripts en Git junto al código fuente.

> 🌐 **Descarga e información oficial:**  
> - Sitio Web Oficial: [https://www.usebruno.com/](https://www.usebruno.com/)  
> - Documentación de Bruno: [https://docs.usebruno.com/](https://docs.usebruno.com/)

---

### Cómo abrir y usar la colección de este proyecto en Bruno

1. Abre la aplicación **Bruno** en tu ordenador.
2. Haz clic en **Open Collection**.
3. Selecciona la carpeta `bruno/` ubicada en la raíz de este proyecto (`/hono-test/bruno`).
4. En la esquina superior derecha de Bruno, selecciona el entorno **`Local`** (configurado en `http://localhost:3011`).
5. **Flujo de prueba recomendado en Bruno:**
   - Abre la carpeta **`Auth`** y pulsa **Send** en `Login Admin` o `Login User`.  
     *(Un script post-response guardará automáticamente el `token`, `refreshToken` y `sessionId` en las variables de Bruno).*
   - Ve a la carpeta **`Tasks`** o **`Users`** y ejecuta cualquier petición: el header `Authorization: Bearer {{token}}` ya está configurado a nivel de colección y se enviará de forma automática.
   - Ve a la carpeta **`Sessions`** para consultar tus sesiones activas (`My Sessions`), tirar una sesión o revocarlas todas.

---

## 🛡️ Seguridad y Gestión de Sesiones

### Control de Sesiones en Base de Datos (Stateful Session Check)
A diferencia del JWT tradicional (que no puede ser revocado hasta que vence el tiempo `exp`), cada llamada a un endpoint privado consulta SQLite para verificar:
1. **Estado del Usuario**: Si el usuario ha sido marcado como `isBlocked: true`, se rechaza la petición al instante con **HTTP 403 Forbidden**.
2. **Estado de la Sesión**: Si la sesión ha sido tirada (`isActive: false`), se rechaza de inmediato con **HTTP 401 Unauthorized**.

### Credenciales Preconfiguradas para Pruebas

| Rol | Nombre | Email | Contraseña | Permisos |
|---|---|---|---|---|
| **Admin** | Luis Admin | `admin@example.com` | `password123` | Control total, ver todos los usuarios, bloquear cuentas y tirar sesiones ajenas |
| **User** | Ana García | `ana@example.com` | `password123` | Gestionar exclusivamente sus propias tareas y sesiones |

---

## 📡 Referencia de Endpoints

### 1. Salud del Sistema
| Método | Endpoint | Descripción | Auth |
|---|---|---|---|
| `GET` | `/healthz` | Diagnóstico de uptime y latencia real a SQLite | No |
| `GET` | `/docs` | Interfaz gráfica interactiva de documentación | No |

---

### 2. Autenticación (`/api/auth`)
| Método | Endpoint | Descripción | Rate Limit |
|---|---|---|---|
| `POST` | `/api/auth/login` | Inicia sesión, crea registro de `Session` y emite tokens | 10 req/min |
| `POST` | `/api/auth/refresh` | Renueva el Access Token con **Token Rotation** | No |
| `POST` | `/api/auth/logout` | Revoca la sesión en base de datos e invalida tokens | No |

---

### 3. Sesiones Activas (`/api/sessions`)
*Requiere `Authorization: Bearer <TOKEN>`*

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/sessions/me` | Lista todas las sesiones activas/inactivas del usuario con IP y User-Agent |
| `DELETE` | `/api/sessions/:sessionId` | **Tirar sesión específica**: Invalida de inmediato el token de ese dispositivo |
| `POST` | `/api/sessions/revoke-all` | **Tirar todas las sesiones**: Cierra sesión en todos los dispositivos |

---

### 4. Tareas (`/api/tasks`)
*Requiere `Authorization: Bearer <TOKEN>` - Aislamiento estricto por usuario autenticado*

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/tasks` | Lista paginada (`?page=1&limit=10&search=texto&completed=true`) |
| `GET` | `/api/tasks/:id` | Detalle de una tarea (solo si le pertenece al usuario) |
| `POST` | `/api/tasks` | Crea tarea (se asigna automáticamente al usuario del token) |
| `PUT` | `/api/tasks/:id` | Modifica título, descripción o estado de una tarea propia |
| `DELETE` | `/api/tasks/:id` | Elimina una tarea propia |

---

### 5. Usuarios (`/api/users`)
*Requiere `Authorization: Bearer <TOKEN>`*

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/users` | Lista paginada de usuarios (`?page=1&limit=10&search=ana&role=user`) |
| `GET` | `/api/users/:id` | Detalle de un usuario |
| `POST` | `/api/users` | Crear nuevo usuario (hashea contraseña con bcrypt) |
| `PUT` | `/api/users/:id` | Actualizar nombre, email o contraseña de un usuario |
| `PATCH` | `/api/users/:id/block` | **Bloquear o desbloquear usuario** *(Admin)*: Tira todas sus sesiones al instante |
| `POST` | `/api/users/:id/revoke-sessions` | Tirar todas las sesiones activas de un usuario concreto |
| `DELETE` | `/api/users/:id` | Borra usuario y elimina en cascada todas sus tareas, sesiones y tokens |

---

## 🧪 Pruebas Automatizadas

El proyecto incluye el script ejecutable [`test-api.sh`](test-api.sh) que valida de extremo a extremo todo el ciclo de vida:

```bash
# Con el servidor corriendo en otra terminal:
./test-api.sh
```

El script comprueba automáticamente:
1. Healthcheck profundo con comprobación de conexión a SQLite.
2. Servidor de documentación `/docs` y especificación OpenAPI.
3. Inyección de `X-Request-Id` y cabeceras de seguridad HTTP.
4. Login con validación Bcrypt y generación de `Session` en base de datos.
5. Cabeceras de Rate Limiting.
6. Consulta de sesiones activas del usuario.
7. **Tirada de sesión específica**: Comprueba que el token es rechazado de inmediato con `401`.
8. **Bloqueo de cuenta por Admin**: Comprueba el corte inmediato con `403` y el rechazo en futuros logins.
9. **Desbloqueo de cuenta**: Comprueba la reactivación del acceso.
10. Paginación, búsqueda textual y filtros en tareas.

---

## 🛠️ Herramientas y Comandos de Utilidad

```bash
# Iniciar servidor en desarrollo con hot-reload
npm run dev

# Abrir panel visual de base de datos (Prisma Studio)
npx prisma studio

# Sincronizar cambios del archivo schema.prisma
npx prisma db push

# Verificar tipos de TypeScript
npx tsc --noEmit
```

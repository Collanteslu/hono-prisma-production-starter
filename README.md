# ⚡ Hono + Prisma 7 (SQLite) Production REST API Starter Template

[![CI & Typecheck](https://github.com/Collanteslu/hono-prisma-production-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/Collanteslu/hono-prisma-production-starter/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Hono](https://img.shields.io/badge/Hono-v4-E36002.svg)](https://hono.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-v7-2D3748.svg)](https://www.prisma.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![OpenAPI / Scalar](https://img.shields.io/badge/Docs-Scalar%20OpenAPI-6366f1.svg)](https://scalar.com/)

> **A production-ready, batteries-included REST API GitHub template** built with **TypeScript**, **[Hono](https://hono.dev/)**, **[Prisma 7](https://www.prisma.io/)** (embedded SQLite via LibSQL Driver Adapter), **[Zod](https://zod.dev/)**, **Bcrypt**, **Stateful Sessions with real-time revocation and user blocking**, **Rate Limiting**, **Graceful Shutdown**, **Docker containerization**, and interactive **[Scalar OpenAPI](https://scalar.com/)** documentation.

---

## 🎯 Why Use This Template?

Starting a backend project often requires reimplementing the same boilerplate: authentication, password hashing, session revocation, input validation, rate limiting, and database models.

This template gives you an **opinionated, robust, production-grade foundation**:
- **Zero External Dependencies to Run**: Uses embedded SQLite with Prisma 7 Driver Adapters. Anyone can clone and run it instantly without configuring Docker, PostgreSQL, or Redis.
- **Enterprise-Grade Authentication**: Access Tokens (15 min) + Refresh Tokens (7 days) with **Token Rotation** and **Stateful Session tracking** in SQLite.
- **Instant Revocation & Real-Time Suspension**: Suspend accounts or revoke active sessions immediately; requests are rejected in real-time without waiting for JWT expiration.
- **Strict User Ownership**: Standard users can only interact with tasks they own.
- **OpenAPI 3.0 & Swagger/Scalar Included**: Interactive web documentation served out-of-the-box at `/docs`.
- **Git-Integrated API Testing**: Full collection included for **[Bruno API Client](https://www.usebruno.com/)** with automated token propagation.

---

## 📑 Table of Contents
1. [Architecture & Project Structure](#-architecture--project-structure)
2. [Quickstart (3 Steps)](#-quickstart-in-3-steps)
3. [Using as a GitHub Template](#-using-as-a-github-template)
4. [Interactive API Documentation (Scalar)](#-interactive-api-documentation-scalar)
5. [Testing with Bruno API Client](#-testing-with-bruno-api-client)
6. [Stateful Sessions & Security Model](#-stateful-sessions--security-model)
7. [Endpoints Reference](#-endpoints-reference)
8. [Automated Test Suite](#-automated-test-suite)
9. [Docker Deployment](#-docker-deployment)
10. [Contributing & Development Guidelines](#-contributing--development-guidelines)
11. [License](#-license)

---

## 🏗️ Architecture & Project Structure

```text
hono-prisma-production-starter/
├── .env                              # Local environment variables
├── .env.example                      # Production environment template
├── .github/
│   ├── workflows/ci.yml              # GitHub Actions CI (Typechecking & Build)
│   ├── ISSUE_TEMPLATE/               # Bug report & feature request forms
│   └── PULL_REQUEST_TEMPLATE.md      # Standard PR checklist
├── prisma.config.ts                  # Prisma 7 configuration file
├── prisma/
│   └── schema.prisma                 # Domain models: User, Session, RefreshToken, Task
├── bruno/                            # Complete collection for Bruno API Client
│   ├── bruno.json                    # Bruno collection metadata
│   ├── collection.bru                # Global Authorization Bearer header
│   ├── environments/Local.bru        # Local environment variables (baseUrl, token)
│   ├── Auth/                         # Login Admin, Login User, Refresh, Logout
│   ├── Sessions/                     # List sessions, Revoke session, Revoke all
│   ├── Users/                        # Paginated user CRUD, Block / Unblock user
│   └── Tasks/                        # Paginated & filtered task CRUD
├── src/
│   ├── config/
│   │   └── env.ts                    # Zod-validated environment variables
│   ├── db.ts                         # Prisma 7 client & automatic seeder
│   ├── docs/
│   │   └── openapi.ts                # Complete OpenAPI 3.0 specification
│   ├── jobs/
│   │   └── cleanup.ts                # Background routine purging expired sessions
│   ├── middleware/
│   │   ├── auth.ts                   # Stateful session & real-time block check
│   │   ├── rateLimit.ts              # IP-based rate limiter middleware
│   │   └── requestId.ts              # Tracing header (X-Request-Id)
│   ├── routes/
│   │   ├── auth.ts                   # /api/auth routes
│   │   ├── sessions.ts               # /api/sessions routes
│   │   ├── users.ts                  # /api/users routes
│   │   └── tasks.ts                  # /api/tasks routes
│   ├── schemas/
│   │   └── index.ts                  # Zod schemas for bodies and query parameters
│   ├── types/
│   │   └── index.ts                  # TypeScript interfaces and Hono AppEnv
│   ├── utils/
│   │   └── password.ts               # Bcrypt password hashing utilities
│   └── index.ts                      # Main entrypoint, global middlewares & shutdown
├── test-api.sh                       # End-to-end bash test suite
├── Dockerfile                        # Multi-stage production container
├── docker-compose.yml                # Production Compose configuration
└── LICENSE                           # MIT License
```

---

## ⚡ Quickstart in 3 Steps

### Prerequisites
- **Node.js** v18.14.0 or higher (Tested on Node v20 & v24)
- **npm** v9 or higher

```bash
# 1. Clone or generate your repository
git clone https://github.com/your-username/your-repo-name.git
cd your-repo-name

# 2. Install dependencies & initialize SQLite database
npm install
npx prisma db push

# 3. Start development server with hot-reload
npm run dev
```

The API will be running on:
```text
http://localhost:3011
```

*(On first startup, default demo accounts and tasks are automatically seeded into SQLite with bcrypt-hashed passwords).*

---

## 📋 Using as a GitHub Template

1. Click the green **"Use this template"** button at the top of the repository in GitHub.
2. Choose **"Create a new repository"**.
3. Name your repository and clone it to your local machine.
4. Update `package.json` with your project's name and details.
5. You now have a complete, secure API architecture ready to build features upon.

---

## 📖 Interactive API Documentation (Scalar)

The API ships with an interactive, modern web console powered by **[Scalar](https://scalar.com/)**:

- **Interactive API Console:** [http://localhost:3011/docs](http://localhost:3011/docs)
- **OpenAPI 3.0 JSON Spec:** [http://localhost:3011/openapi.json](http://localhost:3011/openapi.json)

You can explore endpoints, inspect request and response schemas, and execute live HTTP calls with Bearer Token authorization directly from your browser.

---

## 🐶 Testing with Bruno API Client

### What is Bruno?
**[Bruno](https://www.usebruno.com/)** is an open-source, lightweight, fast API client built as a modern, offline-first alternative to Postman and Insomnia.
- **Git-Friendly**: Collections are stored as human-readable `.bru` plain-text files inside your repository.
- **No Cloud Required**: Your requests, headers, and secrets remain 100% on your local machine.

> 🌐 **Official Links:**  
> - Official Website: [https://www.usebruno.com/](https://www.usebruno.com/)  
> - Documentation: [https://docs.usebruno.com/](https://docs.usebruno.com/)

### How to use the included collection
1. Open **Bruno**.
2. Click **Open Collection** and select the [`bruno/`](bruno/) folder in the repository.
3. Select the **`Local`** environment from the top-right environment picker.
4. Run `Login Admin` or `Login User` under `Auth/`:
   - An automated post-response script stores the `token`, `refreshToken`, and `sessionId` into your environment.
   - All subsequent calls in `Tasks/`, `Users/`, and `Sessions/` automatically send the `Authorization: Bearer {{token}}` header.

---

## 🛡️ Stateful Sessions & Security Model

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Hono as Hono Router & Auth Middleware
    participant SQLite as SQLite Database (Prisma 7)

    Client->>Hono: POST /api/auth/login { email, password }
    Hono->>SQLite: Verify credentials (bcrypt) & create Session
    SQLite-->>Hono: Session created (ID, UserAgent, IP)
    Hono-->>Client: Returns Access Token (15m) + Refresh Token (7d)

    Client->>Hono: GET /api/tasks (Bearer Access Token)
    Hono->>Hono: Verify JWT signature & expiration
    Hono->>SQLite: Check user.isBlocked === false AND session.isActive === true
    alt User is blocked OR session is inactive
        SQLite-->>Hono: Rejected (Blocked: 403 / Inactive: 401)
        Hono-->>Client: Immediate Access Denied (Real-Time Revocation)
    else Active & Valid
        SQLite-->>Hono: OK
        Hono->>SQLite: Fetch tasks where userId === currentUser.userId
        SQLite-->>Hono: Return user tasks
        Hono-->>Client: 200 OK (Paginated tasks)
    end
```

### Pre-seeded Demo Credentials

| Role | Name | Email | Password | Permissions |
|---|---|---|---|---|
| **Admin** | Luis Admin | `admin@example.com` | `password123` | Full access, user management, account suspension, session revocation |
| **User** | Ana García | `ana@example.com` | `password123` | Standard access, owns personal tasks and sessions |

---

## ⚡ Type-Safe RPC Client (`hc`)

The starter exports `AppType` from `src/index.ts`. Any TypeScript frontend (Next.js, Vite, React, Astro, mobile) can consume this API with **end-to-end static type safety** without manual type generation or Swagger codegen:

```ts
import { hc } from "hono/client";
import type { AppType } from "./src/index.js";

const client = hc<AppType>("http://localhost:3011");

// Fully typed autocompletion for routes, query params, request body, and responses!
const res = await client.api.tasks.$get({
  query: { limit: "10", completed: "false" }
});
const data = await res.json();
console.log(data.data[0].title);
```

---

## 🔗 Relational Expansion (`?include=...`)

Just like in NestJS / Prisma Eager Loading, endpoints support dynamic relational expansion via the `?include=` query parameter, avoiding N+1 roundtrips:

- **List users with embedded tasks and active sessions:**
  ```http
  GET /api/users?include=tasks,sessions
  ```
- **List tasks with embedded user profile:**
  ```http
  GET /api/tasks?include=user
  ```

Supported securely via the reusable whitelist helper `src/lib/relations.ts`. Sensitive fields (such as password hashes) remain automatically sanitized.

---

## 📦 Standard Response Envelope & Telemetry

Following API conventions (JSON:API, RFC 7807), responses include telemetry metadata (`meta`) and standard HTTP headers (`Server-Timing`, `X-Response-Time`, `X-Request-Id`):

```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "total": 42,
    "page": 1,
    "limit": 10,
    "totalPages": 5,
    "hasNextPage": true,
    "hasPrevPage": false
  },
  "meta": {
    "requestId": "e15822e1-4560-4416-836b-67a6d80ff0a9",
    "timestamp": "2026-09-29T20:00:00.000Z",
    "durationMs": 4.12,
    "apiVersion": "1.1.0"
  }
}
```

### HTTP Response Headers
- `X-Request-Id`: Unique request trace identifier.
- `X-Response-Time`: Server-side processing duration (e.g., `4.12ms`).
- `Server-Timing`: Standard W3C timing header (`total;dur=4.12`) displayed natively in Chrome DevTools Network panel.

---

## 📡 Endpoints Reference

### Health & Observability
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/healthz` | Uptime check & active SQLite query latency in ms | No |
| `GET` | `/docs` | Interactive Scalar OpenAPI web documentation | No |
| `GET` | `/openapi.json` | Raw OpenAPI 3.0 schema | No |

### Authentication (`/api/auth`)
| Method | Endpoint | Description | Rate Limit |
|---|---|---|---|
| `POST` | `/api/auth/login` | Authenticate, create database session, issue tokens | 10 req/min |
| `POST` | `/api/auth/refresh` | Renew token pair with **Token Rotation** | No |
| `POST` | `/api/auth/logout` | Deactivate session and revoke refresh tokens | No |

### Session Management (`/api/sessions`)
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/sessions/me` | List all active/inactive sessions with IP & User-Agent | Bearer |
| `DELETE` | `/api/sessions/:sessionId` | **Revoke specific session**: Instantly kicks device | Bearer |
| `POST` | `/api/sessions/revoke-all` | **Revoke all sessions**: Closes all active devices | Bearer |

### Tasks (`/api/tasks`)
*Strict user ownership: Authenticated users only see and manage their own tasks.*

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/tasks` | Paginated list (`?page=1&limit=10&search=text&completed=true&include=user&includeDeleted=true&sort=-createdAt,title&filter[completed]=true`) | Bearer |
| `GET` | `/api/tasks/:id` | Get single task (`?include=user`, 403 if belonging to another user) | Bearer |
| `POST` | `/api/tasks` | Create task (automatically assigned to token's userId, generates AuditLog) | Bearer |
| `PUT` | `/api/tasks/:id` | Update title, description, or completed state (generates AuditLog) | Bearer |
| `DELETE` | `/api/tasks/:id` | **Soft-delete** task (`deletedAt: now()`). Add `?permanent=true` for physical delete | Bearer |

### Users (`/api/users`)
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/users` | Paginated users list (`?page=1&limit=10&search=ana&role=user&include=tasks,sessions&includeDeleted=true&sort=-createdAt,name&filter[role]=user`) | Bearer |
| `GET` | `/api/users/:id` | Get user details (`?include=tasks,sessions`) | Bearer |
| `POST` | `/api/users` | Create user with bcrypt-hashed credentials | Bearer |
| `PUT` | `/api/users/:id` | Update user profile | Bearer |
| `PATCH` | `/api/users/:id/block` | **Suspend / Reactivate User** *(Admin only)*: Immediately revokes all active sessions | Bearer |
| `POST` | `/api/users/:id/revoke-sessions` | Terminate all active sessions for a target user | Bearer |
| `DELETE` | `/api/users/:id` | **Soft-delete** user and revoke all sessions. Add `?permanent=true` for physical cascade delete | Bearer |

### Audit & Security Logs (`/api/audit-logs`)
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/audit-logs` | Query audit trail (`?page=1&limit=20&entity=Task&action=SOFT_DELETE`) | Admin |


---

## 🧪 Automated Testing & Code Quality

### 1. In-Memory Native Tests (Vitest)
Executes high-speed TypeScript unit and integration tests using Hono's in-memory `app.request()` without needing an external HTTP listener:

```bash
# Run all tests once
npm test

# Run tests in interactive watch mode
npm run test:watch
```

### 2. End-to-End Shell Suite (curl)
Runs end-to-end HTTP tests against an active server instance:

```bash
# Ensure server is running (npm run dev), then execute:
npm run test:e2e
```

### 3. Code Formatting & Linting (Biome)
Fast Rust-powered linter and formatter:

```bash
# Check code style and lint rules
npm run lint

# Automatically format and fix issues
npm run lint:fix
```

**Test Coverage Highlights:**
- [x] Deep healthcheck with SQLite latency measurement
- [x] OpenAPI specification & `/docs` availability
- [x] `X-Request-Id` and HTTP security headers
- [x] Bcrypt password verification during login
- [x] IP Rate limiting headers (`X-RateLimit-*`)
- [x] Token Rotation and one-time refresh token validation
- [x] Active session listing and individual session termination (instant 401)
- [x] Admin account suspension (instant 403 on existing tokens & login block)
- [x] Account reactivation
- [x] Task ownership enforcement, pagination, text search, and filters

---

## 🐳 Docker Deployment

The template includes an optimized multi-stage `Dockerfile` (Alpine-based, non-root user) and `docker-compose.yml`:

```bash
# Build and start container in detached mode
docker compose up -d

# View container logs
docker compose logs -f

# Stop container
docker compose down
```

The named volume `sqlite_data` persists your SQLite database across container restarts.

---

## 🤝 Contributing & Development Guidelines

Contributions are welcome! Please follow these steps:

1. **Fork the Repository** and create a feature branch (`git checkout -b feature/amazing-feature`).
2. **Ensure Type Safety**: Run `npm run build` to verify there are zero TypeScript errors.
3. **Run Tests**: Verify your changes with `./test-api.sh`.
4. **Follow Commits Conventions**: Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
5. **Open a Pull Request**: GitHub will automatically load the [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md).

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.

---

## 🧠 AI Agent Skills & Runbooks (`.agents/skills/`)

This repository is equipped with built-in agent **Skills** located in [`.agents/skills/`](.agents/skills/). These runbooks enable AI coding assistants (such as Antigravity / Gemini CLI) and human contributors to follow standardized procedures:

| Skill | Folder | Purpose |
|---|---|---|
| **API Endpoint Creator** | [`.agents/skills/api-endpoint-creator`](.agents/skills/api-endpoint-creator/SKILL.md) | Standard 6-step checklist to design, validate with Zod, and mount new routes |
| **Security Hardening** | [`.agents/skills/security-hardening`](.agents/skills/security-hardening/SKILL.md) | Security auditing runbook: token rotation, real-time blocking, rate limiting, and ownership isolation |
| **OpenAPI Documentation** | [`.agents/skills/openapi-documentation`](.agents/skills/openapi-documentation/SKILL.md) | Procedures for maintaining OpenAPI 3.0 schemas and the interactive Scalar UI |
| **Prisma Database Ops** | [`.agents/skills/prisma-database-ops`](.agents/skills/prisma-database-ops/SKILL.md) | Runbook for schema changes, SQLite Driver Adapters, Studio inspection, and resets |
| **Bruno API Testing** | [`.agents/skills/bruno-testing`](.agents/skills/bruno-testing/SKILL.md) | Guide for creating offline-first Git-versioned requests in Bruno with auto-token propagation |
| **Docker Deployment** | [`.agents/skills/docker-deployment`](.agents/skills/docker-deployment/SKILL.md) | Runbook for containerization, multi-stage builds, non-root security, and SQLite backups |
| **SQL to API Generator** | [`.agents/skills/sql-to-api-generator`](.agents/skills/sql-to-api-generator/SKILL.md) | Runbook to reverse-engineer any SQL/DDL file into full Prisma models, Zod validation, and Hono CRUD routes |

---
name: sql-to-api-generator
description: Reverse-engineers any SQL schema (DDL or .sql file) to generate a complete production REST API with Prisma 7, Zod validation, Hono routes, tests, and documentation.
---

# SQL-to-API Generator Runbook

## Overview
This skill provides automated standard operating procedures for taking any arbitrary SQL schema (DDL statements, `.sql` dump, or existing SQLite/PostgreSQL/MySQL database) and scaffolding an entire production-ready Hono REST API.

---

## 1. Automated 6-Step Workflow

When given a SQL file (e.g. `schema.sql` or inline `CREATE TABLE` statements):

### Step 1: Introspect / Transpile SQL to Prisma Schema
1. **Option A (Automated Prisma Introspection)**:
   If given an active database file or DDL:
   ```bash
   # Load SQL into temporary sqlite db:
   sqlite3 dev.db < schema.sql
   # Reverse-engineer Prisma schema:
   npx prisma db pull
   ```
2. **Option B (Declarative Schema Definition)**:
   Map SQL data types to Prisma 7 schema (`prisma/schema.prisma`):
   - `INTEGER PRIMARY KEY` -> `id String @id @default(uuid())` or `Int @id @default(autoincrement())`
   - `TEXT NOT NULL` -> `String`
   - `BOOLEAN` -> `Boolean @default(false)`
   - `DATETIME` -> `DateTime @default(now())`
   - `FOREIGN KEY (userId) REFERENCES User(id)` -> Relational relation decorators (`@relation(fields: [userId], references: [id], onDelete: Cascade)`).

### Step 2: Create the Migration & Generate Client
```bash
npx prisma migrate dev --name add_<model>
```

### Step 3: Scaffold Zod Validation Schemas (`src/schemas/index.ts`)
For each table/model generated, produce:
1. `create<Model>Schema`: Required fields with formatting checks (`min()`, `email()`, etc.).
2. `update<Model>Schema`: Partial fields with `.refine()` ensuring at least one property is submitted.
3. `<model>QuerySchema`: Pagination (`page`, `limit`), sorting (`sortBy`, `order`), search (`search`), and relational expansions (`include: z.string().optional()`).

### Step 4: Scaffold Hono Route Controller (`src/routes/<models>.ts`)
Follow standard CRUD architectural pattern:
- `GET /api/<models>`: Paginated query with `where` filters, search, and dynamic `include = parseIncludes(...)`.
- `GET /api/<models>/:id`: Single entity retrieval with `include`.
- `POST /api/<models>`: Payload validation via `createRoute({ request: jsonBody(schema) })` + `router.openapi(...)` and `successResponse(c, ..., { status: 201 })`.
- `PUT /api/<models>/:id`: Entity update and 404 handling.
- `DELETE /api/<models>/:id`: Entity deletion with cascading protection.

### Step 5: Mount Route in Application (`src/index.ts`)
Chain route onto `app`:
```ts
const routes = app
  .route("/api/<models>", <model>Routes)
  ...
export type AppType = typeof routes;
```

### Step 6: Generate Automated Tests (`tests/<model>.test.ts`)
Implement in-memory tests using `app.request()` covering:
- Creating a resource (`POST`).
- Listing with pagination and filtering (`GET`).
- Relational expansion (`GET ?include=...`).
- Deleting a resource (`DELETE`).

---

## 2. Dynamic Relational Expansion Guide (`?include=...`)
Always integrate the project's helper `src/lib/relations.ts`:
```ts
import { parseIncludes } from "../lib/relations.js";

const include = parseIncludes(c.req.query("include"), {
  parentModel: true,
  childModels: true
});

const records = await prisma.model.findMany({ where, include });
```

---

## 3. Best Practices Checklist
- [ ] No `any` types: Use generated Prisma models for typed `where` clauses (`<Model>WhereInput`).
- [ ] Wrap responses in `successResponse(c, data, { pagination, message })`.
- [ ] Ensure non-privileged authentication and tenant/ownership isolation if the model references `userId`.
- [ ] Run `npm run lint` and `npm test` to verify 100% test passing and zero linter warnings.

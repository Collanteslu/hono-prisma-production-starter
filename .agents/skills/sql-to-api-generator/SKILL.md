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
   # Load the SQL into a THROWAWAY sqlite db (never into the app's dev.db):
   sqlite3 /tmp/import.db < schema.sql
   # Print the introspected models without touching prisma/schema.prisma,
   # then copy the ones you need into it by hand (db pull would overwrite existing models):
   DATABASE_URL=file:/tmp/import.db npx prisma db pull --print
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
npx prisma generate   # Prisma 7 does not regenerate the client after migrate dev
```

### Step 3: Scaffold Zod Validation Schemas (`src/schemas/index.ts`)
For each table/model generated, produce:
1. `create<Model>Schema`: Required fields with formatting checks (`min()`, `email()`, etc.).
2. `update<Model>Schema`: Partial fields with `.refine()` ensuring at least one property is submitted.
3. `<model>QuerySchema`: Pagination (`page`, `limit`), sorting (`sortBy`, `order`), search (`search`), and relational expansions (`include: z.string().optional()`).

### Step 4: Scaffold the Route Module (`src/routes/<models>.ts`)
Follow the `api-endpoint-creator` skill: one `createRoute(...)` per operation, implemented with `router.openapi(route, handler)` and exported as a **single chained expression** (required for the typed RPC client). Response schemas go in `src/schemas/responses.ts`. Standard CRUD pattern:
- `GET /api/<models>`: Paginated query with `where` filters (`parseFilters`), search, sorting and dynamic `include = parseIncludes(...)`.
- `GET /api/<models>/{id}`: Single entity retrieval with `include`; 404 if missing.
- `POST /api/<models>`: Payload validated by `request: jsonBody(create<Model>Schema)`; respond with `successResponse(c, ..., { status: 201 })`.
- `PUT /api/<models>/{id}`: Entity update and 404 handling.
- `DELETE /api/<models>/{id}`: Entity deletion with cascading protection (prefer soft delete + `?permanent=true` like tasks).

### Step 5: Mount Route in Application (`src/index.ts`)
Add the prefix to the `authMiddleware` list and chain the router onto `routes`:
```ts
const routes = app
  .route("/api/<models>", <model>Routes)
  ...
export type AppType = typeof routes;
```

### Step 6: Generate Automated Tests (`tests/<model>.test.ts`)
Implement in-memory tests using `app.request()` covering:
- Creating a resource (`POST`) and validation errors (`400`).
- Listing with pagination and filtering (`GET`).
- Relational expansion (`GET ?include=...`).
- Deleting a resource (`DELETE`) and ownership/authorization failures (`401`/`403`/`404`).
- The OpenAPI drift test (`tests/openapi.test.ts`) already fails if any new route is left undocumented.

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
- [ ] Run `npm run typecheck`, `npm run lint` and `npm test` to verify everything passes with zero warnings.
- [ ] Add matching requests to the Bruno collection (see the `bruno-testing` skill).

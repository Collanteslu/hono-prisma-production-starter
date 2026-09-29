---
name: prisma-database-ops
description: >-
  Runbook for modifying the database schema, generating clients, executing migrations,
  and seeding SQLite with Prisma 7 and @prisma/adapter-libsql.
---

# Prisma 7 & SQLite Database Operations Skill

Use this skill when modifying database models, relations, adding indexes, or troubleshooting database connectivity.

## Architecture Notes for Prisma 7
- **Configuration**: Managed via `prisma.config.ts` (new in Prisma 7).
- **Driver Adapters**: SQLite uses `@prisma/adapter-libsql` for embedded execution.
- **Client Location**: Explicitly generated into `src/generated/client` via `output` in `prisma/schema.prisma`.

## Standard Operational Workflows

### 1. Adding or Modifying a Model
1. Open `prisma/schema.prisma`.
2. Define fields and relationships:
   ```prisma
   model Note {
     id        String   @id @default(uuid())
     userId    String
     content   String
     createdAt DateTime @default(now())

     // Always specify onDelete: Cascade for user-owned records
     user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
   }
   ```
3. Update the `User` model to declare the reverse relationship:
   ```prisma
   model User {
     // ...
     notes Note[]
   }
   ```

### 2. Creating a Migration for Schema Changes
Create a versioned migration (committed under `prisma/migrations`) and regenerate the client:
```bash
npx prisma migrate dev --name describe_your_change
```
Never use `prisma db push` against real data: production applies migrations with `npx prisma migrate deploy` (done automatically by `docker-entrypoint.sh`).

### 3. Visual Data Inspection (Prisma Studio)
To visually inspect rows, view relations, or edit mock data:
```bash
npx prisma studio
```
Opens the GUI at `http://localhost:5555`.

### 4. Database Reset (Development only)
If you need to reset the local database from scratch:
```bash
npx prisma migrate reset
# Restarting the app will trigger seedDatabase() automatically
```

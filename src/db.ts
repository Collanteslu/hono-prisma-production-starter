/**
 * @file db.ts
 * @description Prisma Client initialization and database seeder for SQLite.
 * Uses Prisma 7 Driver Adapters with @prisma/adapter-libsql for native SQLite performance.
 */

import path from "node:path";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { env, features } from "./config/env.js";
import { PrismaClient } from "./generated/client/client.js";
import { logger } from "./lib/logger.js";
import { hashPassword } from "./utils/password.js";

/**
 * Resolve absolute or relative path to the local SQLite database file,
 * or prioritize DATABASE_URL / TURSO_DATABASE_URL environment variables.
 */
function resolveDatabaseUrl(): string {
  if (env.TURSO_DATABASE_URL) {
    return env.TURSO_DATABASE_URL;
  }
  if (env.DATABASE_URL) {
    // If DATABASE_URL starts with file:, normalize path if relative
    if (env.DATABASE_URL.startsWith("file:")) {
      const rawPath = env.DATABASE_URL.replace(/^file:/, "");
      const resolvedPath = path.isAbsolute(rawPath)
        ? rawPath
        : path.resolve(process.cwd(), rawPath);
      return `file:${resolvedPath}`;
    }
    return env.DATABASE_URL;
  }
  return `file:${path.resolve(process.cwd(), "dev.db")}`;
}

const libsqlUrl = resolveDatabaseUrl();
if (env.TURSO_DATABASE_URL && env.DATABASE_URL) {
  logger.warn(
    "TURSO_DATABASE_URL and DATABASE_URL are both set: TURSO_DATABASE_URL takes precedence, DATABASE_URL is ignored",
  );
}
const adapter = new PrismaLibSql({
  url: libsqlUrl,
  authToken: env.TURSO_AUTH_TOKEN,
  // Wait for the single SQLite writer instead of failing with SQLITE_BUSY under concurrency (ms, local files only)
  timeout: 5000,
});

// Password hashes and MFA secrets are omitted from every query by default; opt in explicitly,
// e.g. `omit: { password: false }`.
export const prisma = new PrismaClient({
  adapter,
  omit: { user: { password: true, totpSecret: true, totpLastStep: true } },
});

/**
 * Switches a local SQLite file to WAL journaling (readers never block behind the single writer)
 * with synchronous=NORMAL, the safe and fast pairing for WAL. Never applied to remote databases.
 *
 * Measured against this adapter: `journal_mode` is stored in the database file so it holds for every
 * connection, while `synchronous` is per connection and only covers the one that ran the statement —
 * a pooled writer may still fsync. There is no connection-pool hook in @prisma/adapter-libsql to fix
 * that, so the pragmas stay a best-effort local optimization, not a durability guarantee.
 *
 * `PRAGMA foreign_keys` is already ON on this adapter's connections (verified empirically), so the
 * schema's onDelete: Cascade / SetNull relations do fire and dependents never need manual deletes.
 */
export async function applySqlitePragmas(): Promise<void> {
  if (!libsqlUrl.startsWith("file:")) return;
  const [{ journal_mode }] = await prisma.$queryRawUnsafe<{ journal_mode: string }[]>(
    "PRAGMA journal_mode=WAL;",
  );
  await prisma.$queryRawUnsafe("PRAGMA synchronous=NORMAL;");
  logger.info({ journalMode: journal_mode }, "SQLite pragmas applied at startup");
}

/**
 * Database seeder executed during application startup.
 * Seeds initial demo accounts and tasks with hashed passwords if the database is empty.
 * Security: Disabled in production to prevent hardcoded demo credentials.
 */
export async function seedDatabase() {
  // AUTH_MODE=none has no users: outside production, seed a couple of public example tasks
  if (!features.auth) {
    if (env.NODE_ENV === "production") return;
    if ((await prisma.task.count({ where: { userId: null } })) === 0) {
      await prisma.task.createMany({
        data: [
          {
            title: "Explore the public API",
            description: "AUTH_MODE=none: every route is public and tasks have no owner.",
          },
          {
            title: "Turn authentication on",
            description: "Set AUTH_MODE=basic or full to add users, sessions and roles.",
          },
        ],
      });
      logger.info("🌱 AUTH_MODE=none: seeded public example tasks");
    }
    return;
  }

  const usersCount = await prisma.user.count();

  // In production, optionally bootstrap the primary administrator if environment credentials are provided
  if (env.NODE_ENV === "production") {
    if (usersCount === 0 && env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
      logger.info(`👑 Bootstrapping initial production administrator: ${env.ADMIN_EMAIL}...`);
      const hashedPassword = await hashPassword(env.ADMIN_PASSWORD);
      await prisma.user.create({
        data: {
          name: "System Admin",
          email: env.ADMIN_EMAIL.toLowerCase(),
          password: hashedPassword,
          role: "admin",
          emailVerifiedAt: new Date(),
        },
      });
      logger.info("✔ Production administrator created successfully.");
    } else {
      logger.info("🔒 Production mode active: Demo seeder disabled.");
    }
    return;
  }

  if (usersCount === 0) {
    logger.info("🌱 Initializing database with default seeded accounts and tasks...");

    const hashedPassword = await hashPassword("password123");

    // 1. Create Admin User
    const admin = await prisma.user.create({
      data: {
        id: "user-1",
        name: "Luis Admin",
        email: "admin@example.com",
        password: hashedPassword,
        role: "admin",
        emailVerifiedAt: new Date(),
        tasks: {
          create: [
            {
              id: "task-1",
              title: "Learn Hono Framework",
              description: "Understand router, middlewares, and context in Hono.",
              completed: false,
            },
            {
              id: "task-2",
              title: "Configure JWT and Roles",
              description: "Protect private routes using authentication middleware.",
              completed: true,
            },
          ],
        },
      },
    });

    // 2. Create Standard User
    const user = await prisma.user.create({
      data: {
        id: "user-2",
        name: "Ana García",
        email: "ana@example.com",
        password: hashedPassword,
        role: "user",
        emailVerifiedAt: new Date(),
        tasks: {
          create: [
            {
              id: "task-3",
              title: "Design Frontend UI",
              description: "Build web dashboard consuming the REST API.",
              completed: false,
            },
          ],
        },
      },
    });

    logger.info(`✔ Database seeded successfully (Admin: ${admin.email}, User: ${user.email})`);
  }
}

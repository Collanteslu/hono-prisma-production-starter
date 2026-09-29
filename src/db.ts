/**
 * @file db.ts
 * @description Prisma Client initialization and database seeder for SQLite.
 * Uses Prisma 7 Driver Adapters with @prisma/adapter-libsql for native SQLite performance.
 */

import path from "node:path";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { env } from "./config/env.js";
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
const adapter = new PrismaLibSql({
  url: libsqlUrl,
  authToken: env.TURSO_AUTH_TOKEN,
});

export const prisma = new PrismaClient({ adapter });

/**
 * Database seeder executed during application startup.
 * Seeds initial demo accounts and tasks with hashed passwords if the database is empty.
 * Security: Disabled in production to prevent hardcoded demo credentials.
 */
export async function seedDatabase() {
  if (env.NODE_ENV === "production") {
    logger.info("🔒 Production mode detected: Skipping demo seeder.");
    return;
  }

  const usersCount = await prisma.user.count();

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

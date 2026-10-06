import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { assertMigrationsUpToDate } from "../src/lib/migrations.js";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "prisma", "migrations");
// A migration that certainly exists in every checkout of this repository
const SAMPLE = "0_init";

function checksumOf(name: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql")))
    .digest("hex");
}

async function rowFor(name: string) {
  const [row] = await prisma.$queryRaw<{ checksum: string; finished_at: number | null }[]>`
    SELECT checksum, finished_at FROM _prisma_migrations WHERE migration_name = ${name}
  `;
  return row;
}

describe("assertMigrationsUpToDate", () => {
  it("resolves against the migrated test database", async () => {
    await expect(assertMigrationsUpToDate()).resolves.toBeUndefined();
  });

  it("rejects when an applied migration file was modified", async () => {
    const original = await rowFor(SAMPLE);
    try {
      await prisma.$executeRaw`
        UPDATE _prisma_migrations SET checksum = ${"0".repeat(64)} WHERE migration_name = ${SAMPLE}
      `;
      await expect(assertMigrationsUpToDate()).rejects.toThrow(/Modified after being applied/);
    } finally {
      await prisma.$executeRaw`
        UPDATE _prisma_migrations SET checksum = ${checksumOf(SAMPLE)} WHERE migration_name = ${SAMPLE}
      `;
    }
    expect((await rowFor(SAMPLE)).checksum).toBe(original.checksum);
    await expect(assertMigrationsUpToDate()).resolves.toBeUndefined();
  });

  it("rejects when a migration is recorded as failed", async () => {
    const original = await rowFor(SAMPLE);
    try {
      await prisma.$executeRaw`
        UPDATE _prisma_migrations SET finished_at = NULL WHERE migration_name = ${SAMPLE}
      `;
      await expect(assertMigrationsUpToDate()).rejects.toThrow(/Failed \(never completed\)/);
    } finally {
      await prisma.$executeRaw`
        UPDATE _prisma_migrations SET finished_at = ${Number(original.finished_at)} WHERE migration_name = ${SAMPLE}
      `;
    }
    await expect(assertMigrationsUpToDate()).resolves.toBeUndefined();
  });

  it("rejects when a migration is pending or applied but untracked", async () => {
    const renamed = `${SAMPLE}__temporarily_renamed`;
    try {
      await prisma.$executeRaw`
        UPDATE _prisma_migrations SET migration_name = ${renamed} WHERE migration_name = ${SAMPLE}
      `;
      await expect(assertMigrationsUpToDate()).rejects.toThrow(
        /Pending.*\n.*Applied but absent from prisma\/migrations/s,
      );
    } finally {
      await prisma.$executeRaw`
        UPDATE _prisma_migrations SET migration_name = ${SAMPLE} WHERE migration_name = ${renamed}
      `;
    }
    await expect(assertMigrationsUpToDate()).resolves.toBeUndefined();
  });
});

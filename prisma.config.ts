import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

dotenv.config();

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./dev.db";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url,
  },
});

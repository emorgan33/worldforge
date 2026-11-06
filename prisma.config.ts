import { defineConfig } from "prisma/config";
import { createSqliteAdapter } from "./src/lib/prisma-adapter";
export default defineConfig({
  schema: "prisma/schema.prisma",
  experimental: { adapter: true },
  engine: "js",
  adapter: async () => createSqliteAdapter(),
  migrations: { seed: "tsx prisma/seed.ts" },
});

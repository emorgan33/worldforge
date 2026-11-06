import { defineConfig } from "prisma/config";
import { createSqliteAdapter, loadLocalEnv } from "./src/lib/prisma-adapter";

loadLocalEnv();
export default defineConfig({
  schema: "prisma/schema.prisma",
  experimental: { adapter: true },
  engine: "js",
  adapter: async () => createSqliteAdapter(),
  migrations: { seed: "tsx prisma/seed.ts" },
});

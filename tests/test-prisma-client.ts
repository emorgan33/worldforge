import { PrismaClient } from "@prisma/client";
import { createSqliteAdapter } from "../src/lib/prisma-adapter";
import { prisma } from "../src/lib/db";

type TestClientOptions = {
  datasourceUrl?: string;
  datasources?: { db?: { url?: string } };
  log?: unknown;
};

/**
 * Tests run serially in one process. Reuse the application's single client so
 * SQLite write locks cannot block the event loop between two synchronous
 * better-sqlite3 connections. Isolated-database tests receive their own client
 * for the copied file. `$disconnect` is a no-op for the shared client so
 * per-test cleanup does not close it for later tests in the same file.
 */
export function testPrismaClient(options?: TestClientOptions): PrismaClient {
  const url = options?.datasourceUrl ?? options?.datasources?.db?.url;
  if (url) return new PrismaClient({ adapter: createSqliteAdapter(url) });
  return new Proxy(prisma, {
    get(target, property, receiver) {
      if (property === "$disconnect") return async () => undefined;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

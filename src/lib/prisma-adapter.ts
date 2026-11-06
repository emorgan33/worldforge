import { resolve } from "node:path";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import type {
  IsolationLevel,
  SqlDriverAdapter,
  SqlDriverAdapterFactory,
  SqlMigrationAwareDriverAdapterFactory,
  SqlQuery,
  SqlResultSet,
  Transaction,
} from "@prisma/driver-adapter-utils";

export function sqliteFilePath(url = process.env.DATABASE_URL): string {
  if (!url) throw new Error("DATABASE_URL is required.");
  if (!url.startsWith("file:")) throw new Error("DATABASE_URL must use a file: SQLite URL.");
  const [rawPath] = url.slice("file:".length).split("?");
  if (!rawPath) throw new Error("DATABASE_URL must name a SQLite file.");
  if (rawPath === ":memory:" || rawPath.startsWith(":memory:")) return ":memory:";
  return rawPath.startsWith("/") ? rawPath : resolve(process.cwd(), "prisma", rawPath);
}

/**
 * better-sqlite3 is synchronous. Without a process-wide queue, a transaction
 * on one connection can block the event loop while another connection waits for
 * the same SQLite write lock. Serialize adapter calls and hold the queue for a
 * whole transaction so callers wait asynchronously instead.
 */
class AsyncLock {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolveGate) => { release = resolveGate; });
    await previous;
    return release;
  }
}

const lock = new AsyncLock();

async function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const release = await lock.acquire();
  try {
    return await operation();
  } finally {
    release();
  }
}

function wrapTransaction(transaction: Transaction, release: () => void): Transaction {
  return {
    options: transaction.options,
    provider: transaction.provider,
    adapterName: transaction.adapterName,
    queryRaw: (query: SqlQuery): Promise<SqlResultSet> => transaction.queryRaw(query),
    executeRaw: (query: SqlQuery): Promise<number> => transaction.executeRaw(query),
    commit: async () => { try { await transaction.commit(); } finally { release(); } },
    rollback: async () => { try { await transaction.rollback(); } finally { release(); } },
  };
}

function wrapAdapter(adapter: SqlDriverAdapter): SqlDriverAdapter {
  const wrapped: SqlDriverAdapter = {
    provider: adapter.provider,
    adapterName: adapter.adapterName,
    queryRaw: (query: SqlQuery) => serialized(() => adapter.queryRaw(query)),
    executeRaw: (query: SqlQuery) => serialized(() => adapter.executeRaw(query)),
    executeScript: (script: string) => serialized(() => adapter.executeScript(script)),
    dispose: () => serialized(() => adapter.dispose()),
    async startTransaction(isolationLevel?: IsolationLevel) {
      const release = await lock.acquire();
      try {
        return wrapTransaction(await adapter.startTransaction(isolationLevel), release);
      } catch (error) {
        release();
        throw error;
      }
    },
  };
  if (adapter.getConnectionInfo) wrapped.getConnectionInfo = () => adapter.getConnectionInfo!();
  return wrapped;
}

class SerializedSqliteFactory implements SqlMigrationAwareDriverAdapterFactory {
  readonly provider = "sqlite";
  readonly adapterName: string;
  constructor(private readonly factory: SqlDriverAdapterFactory & { connectToShadowDb(): Promise<SqlDriverAdapter> }) {
    this.adapterName = factory.adapterName;
  }
  async connect(): Promise<SqlDriverAdapter> {
    return wrapAdapter(await this.factory.connect());
  }
  async connectToShadowDb(): Promise<SqlDriverAdapter> {
    return wrapAdapter(await this.factory.connectToShadowDb());
  }
}

export function createSqliteAdapter(url = process.env.DATABASE_URL) {
  return new SerializedSqliteFactory(
    new PrismaBetterSQLite3({ url: sqliteFilePath(url) }, { timestampFormat: "unixepoch-ms" }),
  );
}

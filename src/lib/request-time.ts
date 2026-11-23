import { connection } from "next/server";

/**
 * Declare a page or layout as request-time before it touches the database.
 *
 * better-sqlite3 completes queries synchronously and Prisma reads the clock
 * while it runs them, so without this boundary the partial-prerender shell
 * executes the query and Next aborts the route with
 * `blocking-prerender-current-time` (see #39).
 *
 * Call this from a Server Component page or layout. Do not call it from a
 * Route Handler or a plain script: `connection()` requires a render scope.
 */
export async function requireRequestTime() {
  await connection();
}

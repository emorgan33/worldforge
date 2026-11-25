/**
 * Log a server error without serializing arbitrary errors, messages, or request
 * values. Error messages can embed invocation arguments (Prisma) and private
 * campaign or note content, so production logs carry only an operation label,
 * the error class, and an allowlisted code (for example Prisma P2002).
 */
export function logServerError(operation: string, error: unknown) {
  const name = error instanceof Error && error.name ? error.name : "Error";
  const rawCode = (error as { code?: unknown } | null)?.code;
  const code = typeof rawCode === "string" && /^[A-Za-z0-9._-]{1,40}$/.test(rawCode) ? ` (${rawCode})` : "";
  console.error(`${operation}: ${name}${code}`);
}

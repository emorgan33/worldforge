/**
 * Log a server error without serializing arbitrary objects. Error objects can
 * carry driver metadata or request-derived values; server logs should contain
 * an operation label and message, never campaign content, note text, passwords,
 * or session/setup tokens.
 */
export function logServerError(operation: string, error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error";
  console.error(`${operation}: ${message}`);
}

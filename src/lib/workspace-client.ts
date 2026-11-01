/** Small client-side HTTP boundary for workspace requests. */

export class WorkspaceHttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "WorkspaceHttpError";
    this.status = status;
    this.code = code;
  }
}

export type Decoder<T> = (value: unknown) => value is T;

/** Parse an API response and reject both HTTP failures and malformed success DTOs. */
export async function readWorkspaceJson<T>(
  response: Response,
  decode: Decoder<T>,
  context: string,
): Promise<T> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    if (!response.ok) throw new WorkspaceHttpError(`${context} (HTTP ${response.status}).`, response.status);
    throw new Error(`${context} response was invalid.`);
  }

  if (!response.ok) {
    const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const message = typeof body.error === "string" ? body.error : `${context} (HTTP ${response.status}).`;
    const code = typeof body.code === "string" ? body.code : undefined;
    throw new WorkspaceHttpError(message, response.status, code);
  }

  if (!decode(value)) throw new Error(`${context} response had an invalid shape.`);
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}


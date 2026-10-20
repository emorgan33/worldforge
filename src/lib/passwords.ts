import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
const config = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
function derive(password: string, salt: string) { return new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, config, (error, key) => error ? reject(error) : resolve(key))); }
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export async function hashPassword(password: string) { const salt = randomBytes(16).toString("hex"); return `scrypt-v1:${salt}:${(await derive(password, salt)).toString("hex")}`; }
export async function verifyPassword(password: string, encoded: string) {
  const [version, salt, hash] = encoded.split(":");
  if (version !== "scrypt-v1" || !/^[a-f0-9]{32}$/.test(salt || "") || !/^[a-f0-9]{128}$/.test(hash || "")) return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(hash, "hex"));
}
export function validPassword(value: unknown): value is string { return typeof value === "string" && value.length >= 12 && value.length <= 128; }

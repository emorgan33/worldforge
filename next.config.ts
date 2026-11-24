import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";

const REVISION = /^[0-9a-f]{7,40}$/i;

function gitOutput(args: string[]): string | null {
  try {
    const output = execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    // Source archives and container builds exclude .git; the Docker build
    // passes the revision explicitly in that case.
    return null;
  }
}

const suppliedRevision = process.env.WORLDFORGE_BUILD_REVISION?.trim() || null;
const sourceRevision = suppliedRevision ?? gitOutput(["rev-parse", "--verify", "HEAD"]);
const buildRevision = sourceRevision && REVISION.test(sourceRevision) ? sourceRevision : "unknown";
const modifiedSource =
  process.env.WORLDFORGE_BUILD_DIRTY === "1" ||
  (!suppliedRevision && sourceRevision !== null && gitOutput(["status", "--porcelain", "--untracked-files=no"]) !== null);

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' http: https: data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${process.env.NODE_ENV === "development" ? " ws: wss:" : ""}`,
].join("; ");

const nextConfig: NextConfig = {
  env: {
    WORLDFORGE_BUILD_REVISION: buildRevision,
    WORLDFORGE_BUILD_DIRTY: modifiedSource ? "1" : "0",
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: contentSecurityPolicy },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()" },
    ] }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // The CLI checker requires a spawned tsc process; the compiler API keeps
    // production builds compatible with restricted process environments.
    useTypeScriptCli: false,
  },
};

export default nextConfig;

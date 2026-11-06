import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// SQLite 3.54.1 fixes the FTS5 and session-engine CVEs that Prisma's bundled
// 3.46 engine still carries. Pin both the archive and the amalgamation digest.
const RELEASE = "2026/sqlite-amalgamation-3540100.zip";
const SQLITE_SHA3 = "e2b869d3003b33c942b7dd7063604fbc53553e1b66609570df39b9b7b558ee81";
const CUSTOM_DEFINES = `#define SQLITE_ENABLE_FTS5 1
#define SQLITE_ENABLE_FTS3 1
#define SQLITE_ENABLE_FTS3_PARENTHESIS 1
#define SQLITE_ENABLE_JSON1 1
#define SQLITE_ENABLE_MATH_FUNCTIONS 1
#define SQLITE_ENABLE_DBSTAT_VTAB 1
#define SQLITE_DEFAULT_FOREIGN_KEYS 1
#define SQLITE_DQS 0
`;

const require = createRequire(import.meta.url);
const packageDirectory = dirname(require.resolve("better-sqlite3/package.json"));
const workspace = mkdtempSync(join(tmpdir(), "worldforge-sqlite-"));

try {
  const archive = join(workspace, "sqlite.zip");
  const response = await fetch(`https://sqlite.org/${RELEASE}`);
  if (!response.ok) throw new Error(`SQLite download failed: ${response.status}`);
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  execFileSync("unzip", ["-q", archive, "-d", workspace]);
  const source = join(workspace, "sqlite-amalgamation-3540100");
  const checksum = execFileSync("openssl", ["dgst", "-sha3-256", join(source, "sqlite3.c")], { encoding: "utf8" })
    .trim().split(/\s+/).at(-1);
  if (checksum !== SQLITE_SHA3) throw new Error(`SQLite amalgamation digest mismatch: ${checksum}`);
  writeFileSync(join(source, "sqlite3.c"), CUSTOM_DEFINES + readFileSync(join(source, "sqlite3.c"), "utf8"));
  execFileSync("npx", ["--yes", "node-gyp@10", "rebuild", "--release", `--sqlite3=${source}`], {
    cwd: packageDirectory, stdio: "inherit",
  });
  const { default: Database } = await import(pathToFileURL(join(packageDirectory, "lib/index.js")).href);
  const db = new Database(":memory:");
  const version = db.prepare("select sqlite_version()").pluck().get();
  db.close();
  if (version !== "3.54.1") throw new Error(`Expected SQLite 3.54.1, built ${version}`);
  console.log(`better-sqlite3 built with SQLite ${version}`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

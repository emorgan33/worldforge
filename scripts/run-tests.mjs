import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const category = process.argv[2];
const files = readdirSync(path.join(root, "tests"))
  .filter(file => /\.test\.(?:ts|tsx)$/.test(file))
  .sort();

const httpFiles = new Set([
  "world-backup-restore.test.tsx",
  "world-switch.test.tsx",
]);
const productionOnlyFiles = new Set(["production-auth-smoke.test.ts"]);
const servicePattern = /^(?:foundry-import-service|test-isolation|world-creation(?:-migration|-recovery)?|world-management|world-export-roundtrip|stock-art-storage|stock-advisories|stock-review-migration|admin-migration|admin-accounts)\.test\.(?:ts|tsx)$/;

if (!["all", "unit", "service", "http"].includes(category)) {
  throw new Error("Choose a test category: all, unit, service, or http.");
}

const selected = files.filter(file => {
  const isHttp = file.includes("-api.test.") || httpFiles.has(file);
  const isService = servicePattern.test(file);
  if (category === "all") return true;
  if (category === "http") return isHttp;
  if (category === "service") return isService;
  return !isHttp && !isService && !productionOnlyFiles.has(file);
});

const result = spawnSync(process.execPath, [
  "--import", "tsx", "--test", "--test-concurrency=1", ...selected.map(file => path.join("tests", file)),
], { cwd: root, stdio: "inherit", env: process.env });

if (result.error) throw result.error;
process.exit(result.status ?? 1);

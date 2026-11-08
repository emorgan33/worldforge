import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../src/lib/db";
import { assetDirectory, normalizeImage, readAsset, removeAssetFile, writeAsset } from "../src/lib/asset-storage";

const ADMIN_EMAIL = "image-smoke@example.invalid";
const ASSET_ID = "00000000-0000-4000-8000-000000000001";
const EXPECTED_UID = 10001;
const EXPECTED_GID = 10001;

function fail(message: string): never {
  throw new Error(`Release smoke check failed: ${message}`);
}

function assertArchitecture(expected: string) {
  if (!["amd64", "arm64"].includes(expected)) fail(`unsupported expected architecture ${JSON.stringify(expected)}`);
  const dpkg = execFileSync("dpkg", ["--print-architecture"], { encoding: "utf8" }).trim();
  const nodeArch = ({ x64: "amd64", arm64: "arm64" } as Record<string, string>)[process.arch] ?? process.arch;
  const machine = execFileSync("uname", ["-m"], { encoding: "utf8" }).trim();
  const uname = machine === "x86_64" ? "amd64" : ["aarch64", "arm64"].includes(machine) ? "arm64" : machine;
  if (dpkg !== expected || nodeArch !== expected || uname !== expected) {
    fail(`architecture mismatch: expected ${expected}, dpkg ${dpkg}, node ${nodeArch}, uname ${uname}`);
  }
  if (process.getuid?.() !== EXPECTED_UID || process.getgid?.() !== EXPECTED_GID) {
    fail(`runtime uid/gid must be ${EXPECTED_UID}/${EXPECTED_GID}`);
  }
}

async function assertApplicationData() {
  const installation = await prisma.installationAdminState.count();
  if (installation !== 1) fail(`installation singleton count was ${installation}`);
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { role: true } });
  if (admin?.role !== "ADMIN") fail(`seeded administrator ${ADMIN_EMAIL} is missing or not ADMIN`);
}

function storedAssetPath() {
  return path.join(assetDirectory(), `${ASSET_ID}.webp`);
}

function assertStoredAssetPermissions() {
  if ((statSync(storedAssetPath()).mode & 0o777) !== 0o600) fail("stored asset permissions must be 0600");
}

async function prepare(expected: string) {
  assertArchitecture(expected);
  await assertApplicationData();
  const input = await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 12, g: 34, b: 56, alpha: 1 } },
  }).png().toBuffer();
  const normalized = await normalizeImage(input);
  await removeAssetFile(ASSET_ID);
  await writeAsset(ASSET_ID, normalized.data);
  const stored = await readAsset(ASSET_ID);
  const sha256 = createHash("sha256").update(stored).digest("hex");
  if (sha256 !== normalized.sha256) fail("stored asset checksum does not match normalized bytes");
  assertStoredAssetPermissions();
  console.log(`ASSET_SHA256=${sha256}`);
}

async function verify(expected: string, expectedSha256: string) {
  assertArchitecture(expected);
  await assertApplicationData();
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) fail("expected asset checksum is malformed");
  const stored = await readAsset(ASSET_ID);
  const sha256 = createHash("sha256").update(stored).digest("hex");
  if (sha256 !== expectedSha256) fail("persisted asset bytes changed across restart");
  assertStoredAssetPermissions();
  console.log(`Runtime and persistence verified for ${expected}.`);
}

async function main() {
  const mode = process.argv[2];
  const expected = process.argv[3] ?? "";
  try {
    if (mode === "prepare") await prepare(expected);
    else if (mode === "verify") await verify(expected, process.argv[4] ?? "");
    else fail(`unknown mode ${JSON.stringify(mode)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

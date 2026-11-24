import packageMetadata from "../../package.json";

export const UNKNOWN_REVISION = "unknown";

export interface BuildInfo {
  version: string;
  revision: string;
  dirty: boolean;
}

export interface BuildInfoInput {
  version?: string | null;
  revision?: string | null;
  dirty?: boolean | string | null;
}

// next.config.ts defines these keys so the values are captured when the build
// is produced. Keep the references literal: Next replaces them at build time.
const bundledVersion = process.env.WORLDFORGE_BUILD_VERSION;
const bundledRevision = process.env.WORLDFORGE_BUILD_REVISION;
const bundledDirty = process.env.WORLDFORGE_BUILD_DIRTY;

const REVISION = /^[0-9a-f]{7,40}$/i;

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Describe the artifact currently serving requests. `version` and `revision`
 * are baked in at build time; a build from a working tree with tracked changes
 * is marked dirty. An unavailable revision is reported as "unknown" rather than
 * guessed from the running host's checkout.
 */
export function parseBuildInfo(input: BuildInfoInput = {}): BuildInfo {
  const version = "version" in input
    ? (nonEmpty(input.version) ?? "0.0.0")
    : (nonEmpty(bundledVersion) ?? nonEmpty(packageMetadata.version) ?? "0.0.0");
  const rawRevision = "revision" in input ? nonEmpty(input.revision) : nonEmpty(bundledRevision);
  const revision = rawRevision && REVISION.test(rawRevision) ? rawRevision.toLowerCase() : UNKNOWN_REVISION;
  const dirtyValue = "dirty" in input ? input.dirty : bundledDirty;
  const dirty = dirtyValue === true || dirtyValue === "1" || dirtyValue === "true";
  return { version, revision, dirty };
}

export function shortRevision(revision: string): string {
  return REVISION.test(revision) ? revision.slice(0, 7) : revision;
}

/** Compact label for the admin header: `v0.4.10 · 4914ef1`. */
export function formatBuildLabel(info: BuildInfo): string {
  const revision = info.revision === UNKNOWN_REVISION ? "revision unknown" : shortRevision(info.revision);
  return `v${info.version} · ${revision}${info.dirty ? " · modified source" : ""}`;
}

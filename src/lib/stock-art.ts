import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { MAX_IMAGE_BYTES } from "./assets";
import { IMAGE_PLACEMENT_PURPOSES, type ImagePlacementPurpose } from "./image-placement";
import { hasApprovedStockReview, STOCK_VERIFICATION_ORIGINS } from "./stock-provenance";

export const STOCK_ART_SCHEMA_VERSION = 1;
export const MAX_STOCK_ART_THUMBNAIL_BYTES = 2 * 1024 * 1024;
export const MAX_STOCK_ART_EVIDENCE_BYTES = 2 * 1024 * 1024;
export const MAX_STOCK_ART_PIXELS = 40_000_000;
export const MAX_STOCK_ART_ENTRIES_PER_REQUEST = 40;
export const MAX_STOCK_ART_SNAPSHOT_BYTES = 64 * 1024;
export const STOCK_ART_VERIFICATION_ORIGINS = STOCK_VERIFICATION_ORIGINS;
export type StockArtVerificationOrigin = (typeof STOCK_ART_VERIFICATION_ORIGINS)[number];

export class StockArtError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const STOCK_ART_PURPOSES = IMAGE_PLACEMENT_PURPOSES;
export type StockArtPurpose = ImagePlacementPurpose;

export const STOCK_ART_SUBJECTS = [
  "portrait",
  "location",
  "object",
  "category",
  "creature",
  "emblem",
  "architecture",
] as const;
export type StockArtSubject = (typeof STOCK_ART_SUBJECTS)[number];

export const STOCK_ART_LIFECYCLE_STATES = ["available", "retired", "disputed"] as const;
export type StockArtLifecycleState = (typeof STOCK_ART_LIFECYCLE_STATES)[number];

export const STOCK_ART_ALLOWED_USE_KEYS = [
  "applicationBundling",
  "standaloneRedistribution",
  "worldExport",
  "modification",
  "publicDisplay",
] as const;
export type StockArtAllowedUse = "allowed" | "prohibited";

export interface StockArtCollection {
  id: string;
  title: string;
  brief: string;
}

export interface StockArtRequirementReview {
  purpose: StockArtPurpose;
  recommended: boolean;
  rationale: string;
  reviewedCrops: { width: number; height: number; result: "pass" | "fail"; notes?: string }[];
  categorySizes?: { size: 16 | 24 | 32; readable: boolean; notes?: string }[];
}

export interface StockArtManifestEntry {
  id: string;
  version: number;
  collection: string;
  title: string;
  subjectTypes: StockArtSubject[];
  styleTags: string[];
  searchTerms: string[];
  defaultAlt: string;
  visual: {
    contactSheet: string;
    coverageSheet: string;
    recommendations: StockArtRequirementReview[];
  };
  creator: { name: string; url?: string };
  source: { itemUrl: string; originalFilename: string; acquiredAt: string };
  rights: {
    reviewStatus?: "pending" | "approved";
    licenseId: string;
    licenseUrl: string;
    publicDomainBasis?: string;
    evidence: { id: string; file: string; sha256: string; reviewer: string; reviewedAt: string };
  };
  allowedUses: Record<(typeof STOCK_ART_ALLOWED_USE_KEYS)[number], StockArtAllowedUse>;
  attribution: {
    creditText: string;
    required: boolean;
    placement: "adjacent" | "credits-section";
    creatorUrl?: string;
    sourceUrl?: string;
    licenseUrl: string;
    modificationNotice?: string;
  };
  files: { image: string; thumbnail: string };
  derivatives: {
    originalSha256: string;
    imageSha256: string;
    thumbnailSha256: string;
    width: number;
    height: number;
    byteSize: number;
    thumbnail: { width: number; height: number; byteSize: number };
    normalizationRecipe: string;
    modifications: string[];
  };
  lifecycle: {
    state: StockArtLifecycleState;
    reason?: string;
    date?: string;
    replacementEntryId?: string;
  };
}

export interface StockArtCatalog {
  schemaVersion: typeof STOCK_ART_SCHEMA_VERSION;
  catalogRevision: string;
  collections: StockArtCollection[];
  entries: StockArtManifestEntry[];
}

export interface StockArtValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  catalog: StockArtCatalog | null;
  manifestDigest: string | null;
}

export function stockArtDirectory() {
  return path.resolve(process.env.WORLDFORGE_STOCK_ART_DIR || path.join(process.cwd(), "resources/stock-art"));
}

export function stockArtEntryKey(entry: Pick<StockArtManifestEntry, "id" | "version">) {
  return `${entry.id}@${entry.version}`;
}

export function findStockArtEntry(catalog: StockArtCatalog, id: string, version: number) {
  return catalog.entries.find(entry => entry.id === id && entry.version === version) || null;
}

export function isStockArtSelectable(entry: StockArtManifestEntry) {
  return entry.lifecycle.state === "available" && STOCK_ART_ALLOWED_USE_KEYS.every(key => entry.allowedUses[key] === "allowed")
    && (process.env.NODE_ENV !== "production" || hasApprovedStockReview(entry));
}

export async function loadStockArtCatalog(root = stockArtDirectory(), verifyFiles = false) {
  const result = await validateStockArtCatalog({ root, verifyFiles });
  if (!result.ok || !result.catalog) {
    throw new StockArtError(result.errors[0] || "The stock-art catalog is unavailable.", 503);
  }
  return { ...result, catalog: result.catalog };
}

export async function readStockArtImage(root: string, entry: StockArtManifestEntry, variant: "image" | "thumbnail" = "image") {
  const relative = variant === "thumbnail" ? entry.files.thumbnail : entry.files.image;
  const filePath = confinedPath(root, relative);
  if (!filePath) throw new StockArtError("The bundled artwork path is invalid.", 500);
  const limit = variant === "thumbnail" ? MAX_STOCK_ART_THUMBNAIL_BYTES : MAX_IMAGE_BYTES;
  try {
    const bytes = await readFile(filePath);
    if (!bytes.length || bytes.length > limit) throw new StockArtError("The bundled artwork is unavailable.", 503);
    const expected = variant === "thumbnail" ? entry.derivatives.thumbnailSha256 : entry.derivatives.imageSha256;
    if (sha256(bytes) !== expected) throw new StockArtError("The bundled artwork failed its integrity check.", 503);
    return bytes;
  } catch (error) {
    if (error instanceof StockArtError) throw error;
    throw new StockArtError("The bundled artwork is unavailable.", 503);
  }
}

function sha256(bytes: Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown, max = 200): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isOptionalText(value: unknown, max = 500) {
  return value === undefined || (typeof value === "string" && value.length <= max);
}

function isHash(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isHttpUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isIsoDate(value: unknown) {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function textArray(value: unknown, maxItems = 20, maxLength = 80) {
  return Array.isArray(value) && value.length <= maxItems && value.every(item => isText(item, maxLength));
}

function confinedPath(root: string, value: unknown) {
  if (!isText(value, 1024) || path.isAbsolute(value)) return null;
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function validateAllowedUses(value: unknown, errors: string[], field: string) {
  const uses = isRecord(value) ? value : null;
  if (!uses) {
    errors.push(`${field}: allowed uses must be an object.`);
    return null;
  }
  let complete = true;
  for (const key of STOCK_ART_ALLOWED_USE_KEYS) {
    if (!(key in uses)) {
      errors.push(`${field}.${key}: an explicit review outcome is required.`);
      complete = false;
      continue;
    }
    if (uses[key] !== "allowed" && uses[key] !== "prohibited") {
      errors.push(`${field}.${key}: must be "allowed" or "prohibited".`);
      complete = false;
    }
  }
  for (const key of Object.keys(uses)) {
    if (!STOCK_ART_ALLOWED_USE_KEYS.includes(key as (typeof STOCK_ART_ALLOWED_USE_KEYS)[number])) {
      errors.push(`${field}.${key}: unknown allowed-use key.`);
    }
  }
  return complete ? uses as Record<(typeof STOCK_ART_ALLOWED_USE_KEYS)[number], StockArtAllowedUse> : null;
}

function validateRecommendations(value: unknown, errors: string[], field: string) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${field}: at least one placement review is required.`);
    return false;
  }
  if (value.length > STOCK_ART_PURPOSES.length) {
    errors.push(`${field}: contains more reviews than supported placements.`);
  }
  const seen = new Set<string>();
  let recommendedCount = 0;
  value.forEach((raw, index) => {
    const prefix = `${field}[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${prefix}: placement review must be an object.`);
      return;
    }
    const purpose = raw.purpose;
    if (typeof purpose !== "string" || !STOCK_ART_PURPOSES.includes(purpose as StockArtPurpose)) {
      errors.push(`${prefix}.purpose: unknown placement purpose.`);
      return;
    }
    if (seen.has(purpose)) errors.push(`${prefix}.purpose: duplicate placement purpose.`);
    seen.add(purpose);
    if (typeof raw.recommended !== "boolean") errors.push(`${prefix}.recommended: must be true or false.`);
    if (!isText(raw.rationale, 500)) errors.push(`${prefix}.rationale: explain the placement decision.`);
    const recommended = raw.recommended === true;
    if (recommended) recommendedCount += 1;
    const crops = Array.isArray(raw.reviewedCrops) ? raw.reviewedCrops : null;
    if (!crops) {
      errors.push(`${prefix}.reviewedCrops: reviewed crop cases are required.`);
    } else if (recommended && crops.length < 2) {
      errors.push(`${prefix}.reviewedCrops: review at least narrow and wide crop cases.`);
    }
    let hasNarrow = false;
    let hasWide = false;
    crops?.forEach((crop, cropIndex) => {
      const cropPrefix = `${prefix}.reviewedCrops[${cropIndex}]`;
      if (!isRecord(crop)) {
        errors.push(`${cropPrefix}: crop review must be an object.`);
        return;
      }
      if (!isPositiveInteger(crop.width) || !isPositiveInteger(crop.height)) errors.push(`${cropPrefix}: width and height must be positive integers.`);
      else {
        if (crop.height >= crop.width) hasNarrow = true;
        if (crop.width >= crop.height) hasWide = true;
      }
      if (crop.result !== "pass" && crop.result !== "fail") errors.push(`${cropPrefix}.result: must be "pass" or "fail".`);
      if (recommended && crop.result === "fail") errors.push(`${cropPrefix}: a recommended placement cannot fail a reviewed crop.`);
      if (!isOptionalText(crop.notes, 500)) errors.push(`${cropPrefix}.notes: must be at most 500 characters.`);
    });
    if (recommended && purpose !== "category-icon" && (!hasNarrow || !hasWide)) {
      errors.push(`${prefix}.reviewedCrops: record both a narrow and a wide crop case.`);
    }
    if (purpose === "category-icon") {
      const sizes = Array.isArray(raw.categorySizes) ? raw.categorySizes : null;
      if (!sizes) errors.push(`${prefix}.categorySizes: 16, 24 and 32px results are required.`);
      else {
        const seenSizes = new Set<number>();
        for (const size of [16, 24, 32] as const) {
          const review = sizes.find(item => isRecord(item) && item.size === size);
          if (!isRecord(review)) errors.push(`${prefix}.categorySizes: a ${size}px review is required.`);
          else {
            seenSizes.add(size);
            if (typeof review.readable !== "boolean") errors.push(`${prefix}.categorySizes: ${size}px readability must be true or false.`);
            if (recommended && review.readable !== true) errors.push(`${prefix}.categorySizes: a recommended category illustration must be readable at ${size}px.`);
            if (!isOptionalText(review.notes, 500)) errors.push(`${prefix}.categorySizes: notes must be at most 500 characters.`);
          }
        }
        sizes.forEach((item, sizeIndex) => {
          if (isRecord(item) && ![16, 24, 32].includes(item.size as number)) errors.push(`${prefix}.categorySizes[${sizeIndex}].size: only 16, 24 and 32 are supported.`);
        });
        if (seenSizes.size !== 3 && sizes.length >= 3) errors.push(`${prefix}.categorySizes: keep one review per supported size.`);
      }
    } else if (raw.categorySizes !== undefined) {
      errors.push(`${prefix}.categorySizes: only valid for the category-icon purpose.`);
    }
  });
  if (recommendedCount === 0) errors.push(`${field}: at least one placement must be recommended.`);
  return true;
}

function validateAttribution(raw: unknown, errors: string[], field: string) {
  if (!isRecord(raw)) {
    errors.push(`${field}: attribution must be an object.`);
    return;
  }
  if (!isText(raw.creditText, 500)) errors.push(`${field}.creditText: credit text of at most 500 characters is required.`);
  if (typeof raw.required !== "boolean") errors.push(`${field}.required: must be true or false.`);
  if (raw.placement !== "adjacent" && raw.placement !== "credits-section") errors.push(`${field}.placement: must be "adjacent" or "credits-section".`);
  if (raw.creatorUrl !== undefined && !isHttpUrl(raw.creatorUrl)) errors.push(`${field}.creatorUrl: must be an HTTP/HTTPS URL.`);
  if (raw.sourceUrl !== undefined && !isHttpUrl(raw.sourceUrl)) errors.push(`${field}.sourceUrl: must be an HTTP/HTTPS URL.`);
  if (!isHttpUrl(raw.licenseUrl)) errors.push(`${field}.licenseUrl: an HTTP/HTTPS license link is required.`);
  if (!isOptionalText(raw.modificationNotice, 500)) errors.push(`${field}.modificationNotice: must be at most 500 characters.`);
}

function validateEntry(raw: unknown, index: number, root: string, collections: Set<string>, errors: string[], pending: Promise<void>[], verifyEvidence: boolean) {
  const prefix = `entries[${index}]`;
  if (!isRecord(raw)) {
    errors.push(`${prefix}: catalog entry must be an object.`);
    return null;
  }
  if (!isText(raw.id, 80) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.id)) errors.push(`${prefix}.id: use a stable lowercase identifier.`);
  if (!isPositiveInteger(raw.version)) errors.push(`${prefix}.version: version must be a positive integer.`);
  if (!isText(raw.collection, 80) || !collections.has(raw.collection)) errors.push(`${prefix}.collection: reference an existing collection.`);
  if (!isText(raw.title, 200)) errors.push(`${prefix}.title: title of at most 200 characters is required.`);
  if (!isText(raw.defaultAlt, 1000)) errors.push(`${prefix}.defaultAlt: informative default alternative text is required.`);
  const subjects = Array.isArray(raw.subjectTypes) ? raw.subjectTypes : null;
  if (!subjects || subjects.length === 0 || subjects.some(subject => typeof subject !== "string" || !STOCK_ART_SUBJECTS.includes(subject as StockArtSubject))) {
    errors.push(`${prefix}.subjectTypes: use supported subject types.`);
  }
  if (!textArray(raw.styleTags, 20, 80)) errors.push(`${prefix}.styleTags: use up to 20 short tags.`);
  if (!textArray(raw.searchTerms, 30, 80)) errors.push(`${prefix}.searchTerms: use up to 30 short search terms.`);

  const visual = isRecord(raw.visual) ? raw.visual : null;
  if (!visual) errors.push(`${prefix}.visual: visual review is required.`);
  else {
    if (!isText(visual.contactSheet, 500)) errors.push(`${prefix}.visual.contactSheet: reference the reviewed contact sheet.`);
    if (!isText(visual.coverageSheet, 500)) errors.push(`${prefix}.visual.coverageSheet: reference the placement coverage review.`);
    validateRecommendations(visual.recommendations, errors, `${prefix}.visual.recommendations`);
  }

  const creator = isRecord(raw.creator) ? raw.creator : null;
  if (!creator) errors.push(`${prefix}.creator: creator is required.`);
  else {
    if (!isText(creator.name, 200)) errors.push(`${prefix}.creator.name: creator name is required.`);
    if (creator.url !== undefined && !isHttpUrl(creator.url)) errors.push(`${prefix}.creator.url: must be an HTTP/HTTPS URL.`);
  }

  const source = isRecord(raw.source) ? raw.source : null;
  if (!source) errors.push(`${prefix}.source: source details are required.`);
  else {
    if (!isHttpUrl(source.itemUrl)) errors.push(`${prefix}.source.itemUrl: a durable original item URL is required.`);
    if (!isText(source.originalFilename, 300)) errors.push(`${prefix}.source.originalFilename: original filename is required.`);
    if (!isIsoDate(source.acquiredAt)) errors.push(`${prefix}.source.acquiredAt: a valid acquisition date is required.`);
  }

  const rights = isRecord(raw.rights) ? raw.rights : null;
  if (!rights) errors.push(`${prefix}.rights: rights evidence is required.`);
  else {
    if (rights.reviewStatus !== undefined && rights.reviewStatus !== "pending" && rights.reviewStatus !== "approved") errors.push(`${prefix}.rights.reviewStatus: use pending or approved.`);
    if (rights.reviewStatus === "approved" && !hasApprovedStockReview(raw)) errors.push(`${prefix}.rights.reviewStatus: approval requires a named reviewer and valid date, not a placeholder.`);
    if (!isText(rights.licenseId, 200)) errors.push(`${prefix}.rights.licenseId: exact license identifier is required.`);
    if (!isHttpUrl(rights.licenseUrl)) errors.push(`${prefix}.rights.licenseUrl: an HTTP/HTTPS license URL is required.`);
    if (!isOptionalText(rights.publicDomainBasis, 500)) errors.push(`${prefix}.rights.publicDomainBasis: must be at most 500 characters.`);
    const evidence = isRecord(rights.evidence) ? rights.evidence : null;
    if (!evidence) errors.push(`${prefix}.rights.evidence: evidence record is required.`);
    else {
      if (!isText(evidence.id, 200)) errors.push(`${prefix}.rights.evidence.id: a non-sensitive evidence identifier is required.`);
      if (!isHash(evidence.sha256)) errors.push(`${prefix}.rights.evidence.sha256: a SHA-256 digest is required.`);
      if (!isText(evidence.reviewer, 200)) errors.push(`${prefix}.rights.evidence.reviewer: reviewer name is required.`);
      if (!isIsoDate(evidence.reviewedAt)) errors.push(`${prefix}.rights.evidence.reviewedAt: a valid review date is required.`);
      const evidencePath = confinedPath(root, evidence.file);
      if (!evidencePath) errors.push(`${prefix}.rights.evidence.file: keep evidence inside the stock-art bundle.`);
      else if (verifyEvidence) pending.push(stat(evidencePath).then(async info => {
        if (!info.isFile()) errors.push(`${prefix}.rights.evidence.file: evidence file is missing.`);
        else if (info.size > MAX_STOCK_ART_EVIDENCE_BYTES) errors.push(`${prefix}.rights.evidence.file: evidence file must be at most 2 MB.`);
        else if (isHash(evidence.sha256) && sha256(await readFile(evidencePath)) !== evidence.sha256) errors.push(`${prefix}.rights.evidence.file: evidence digest does not match.`);
      }, () => { errors.push(`${prefix}.rights.evidence.file: evidence file is missing.`); }));
    }
  }

  const uses = validateAllowedUses(raw.allowedUses, errors, `${prefix}.allowedUses`);
  validateAttribution(raw.attribution, errors, `${prefix}.attribution`);

  const files = isRecord(raw.files) ? raw.files : null;
  if (!files) errors.push(`${prefix}.files: image and thumbnail paths are required.`);
  else {
    if (!confinedPath(root, files.image)) errors.push(`${prefix}.files.image: keep the image inside the stock-art bundle.`);
    if (!confinedPath(root, files.thumbnail)) errors.push(`${prefix}.files.thumbnail: keep the thumbnail inside the stock-art bundle.`);
  }

  const derivatives = isRecord(raw.derivatives) ? raw.derivatives : null;
  if (!derivatives) errors.push(`${prefix}.derivatives: checksums and dimensions are required.`);
  else {
    for (const key of ["originalSha256", "imageSha256", "thumbnailSha256"] as const) {
      if (!isHash(derivatives[key])) errors.push(`${prefix}.derivatives.${key}: a SHA-256 digest is required.`);
    }
    if (!isPositiveInteger(derivatives.width) || !isPositiveInteger(derivatives.height)) errors.push(`${prefix}.derivatives: dimensions must be positive integers.`);
    else if (derivatives.width * derivatives.height > MAX_STOCK_ART_PIXELS) errors.push(`${prefix}.derivatives: image exceeds the 40 megapixel decode limit.`);
    if (!isPositiveInteger(derivatives.byteSize) || derivatives.byteSize > MAX_IMAGE_BYTES) errors.push(`${prefix}.derivatives.byteSize: image must be at most 10 MB.`);
    const thumb = isRecord(derivatives.thumbnail) ? derivatives.thumbnail : null;
    if (!thumb) errors.push(`${prefix}.derivatives.thumbnail: thumbnail dimensions and size are required.`);
    else {
      if (!isPositiveInteger(thumb.width) || !isPositiveInteger(thumb.height)) errors.push(`${prefix}.derivatives.thumbnail: dimensions must be positive integers.`);
      if (!isPositiveInteger(thumb.byteSize) || thumb.byteSize > MAX_STOCK_ART_THUMBNAIL_BYTES) errors.push(`${prefix}.derivatives.thumbnail.byteSize: thumbnail must be at most 2 MB.`);
    }
    if (!isText(derivatives.normalizationRecipe, 1000)) errors.push(`${prefix}.derivatives.normalizationRecipe: record the normalization recipe.`);
    if (!textArray(derivatives.modifications, 20, 500)) errors.push(`${prefix}.derivatives.modifications: record modifications in up to 20 short entries.`);
  }

  const lifecycle = isRecord(raw.lifecycle) ? raw.lifecycle : null;
  if (!lifecycle) errors.push(`${prefix}.lifecycle: lifecycle state is required.`);
  else {
    if (!STOCK_ART_LIFECYCLE_STATES.includes(lifecycle.state as StockArtLifecycleState)) errors.push(`${prefix}.lifecycle.state: unknown lifecycle state.`);
    if (lifecycle.state !== "available") {
      if (!isText(lifecycle.reason, 500)) errors.push(`${prefix}.lifecycle.reason: explain why the entry is not available.`);
      if (!isIsoDate(lifecycle.date)) errors.push(`${prefix}.lifecycle.date: record the lifecycle change date.`);
    }
    if (!isOptionalText(lifecycle.reason, 500)) errors.push(`${prefix}.lifecycle.reason: must be at most 500 characters.`);
    if (lifecycle.replacementEntryId !== undefined && !isText(lifecycle.replacementEntryId, 80)) errors.push(`${prefix}.lifecycle.replacementEntryId: invalid replacement entry.`);
    if (lifecycle.state === "available") {
      if (uses && STOCK_ART_ALLOWED_USE_KEYS.some(key => uses[key] !== "allowed")) errors.push(`${prefix}.allowedUses: available entries require every distribution use to be explicitly allowed.`);
    }
  }
  return raw;
}

async function validateImageFile(root: string, relative: unknown, expected: { sha256: unknown; width?: unknown; height?: unknown; byteSize?: unknown }, maxBytes: number, errors: string[], field: string) {
  const filePath = confinedPath(root, relative);
  if (!filePath) return;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      errors.push(`${field}: file is missing.`);
      return;
    }
    if (info.size > maxBytes) {
      errors.push(`${field}: file exceeds the allowed size.`);
      return;
    }
    const bytes = await readFile(filePath);
    if (isHash(expected.sha256) && sha256(bytes) !== expected.sha256) errors.push(`${field}: checksum does not match.`);
    const metadata = await sharp(bytes, { limitInputPixels: MAX_STOCK_ART_PIXELS, failOn: "warning" }).metadata();
    if (metadata.format !== "webp") errors.push(`${field}: bundled artwork must be WebP.`);
    if ((metadata.pages || 1) > 1) errors.push(`${field}: animated artwork is not supported.`);
    if (isPositiveInteger(expected.width) && metadata.width !== expected.width) errors.push(`${field}: width does not match the manifest.`);
    if (isPositiveInteger(expected.height) && metadata.height !== expected.height) errors.push(`${field}: height does not match the manifest.`);
  } catch {
    errors.push(`${field}: file could not be decoded as an image.`);
  }
}

export async function validateStockArtCatalog(options: { root?: string; verifyFiles?: boolean } = {}): Promise<StockArtValidationResult> {
  const root = options.root ? path.resolve(options.root) : stockArtDirectory();
  const verifyFiles = options.verifyFiles !== false;
  const errors: string[] = [];
  const warnings: string[] = [];
  let manifestDigest: string | null = null;
  let parsed: unknown;
  try {
    const bytes = await readFile(path.join(root, "manifest.json"));
    manifestDigest = sha256(bytes);
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    errors.push(`manifest.json: ${error instanceof Error ? error.message : "unable to read the catalog manifest."}`);
    return { ok: false, errors, warnings, catalog: null, manifestDigest };
  }
  if (!isRecord(parsed)) {
    errors.push("manifest.json: the manifest must be an object.");
    return { ok: false, errors, warnings, catalog: null, manifestDigest };
  }
  if (parsed.schemaVersion !== STOCK_ART_SCHEMA_VERSION) errors.push(`manifest.json.schemaVersion: expected ${STOCK_ART_SCHEMA_VERSION}.`);
  if (!isText(parsed.catalogRevision, 80)) errors.push("manifest.json.catalogRevision: a bounded catalog revision is required.");

  const collections: StockArtCollection[] = [];
  const collectionIds = new Set<string>();
  if (!Array.isArray(parsed.collections)) errors.push("manifest.json.collections: an array is required.");
  else parsed.collections.forEach((raw, index) => {
    const prefix = `collections[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${prefix}: collection must be an object.`);
      return;
    }
    if (!isText(raw.id, 80) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.id)) errors.push(`${prefix}.id: use a stable lowercase identifier.`);
    else if (collectionIds.has(raw.id)) errors.push(`${prefix}.id: duplicate collection identifier.`);
    else collectionIds.add(raw.id);
    if (!isText(raw.title, 200)) errors.push(`${prefix}.title: title is required.`);
    if (!isText(raw.brief, 2000)) errors.push(`${prefix}.brief: a short collection brief is required.`);
    if (isText(raw.id, 80) && isText(raw.title, 200) && isText(raw.brief, 2000)) collections.push({ id: raw.id, title: raw.title, brief: raw.brief });
  });

  const entries: StockArtManifestEntry[] = [];
  const identities = new Set<string>();
  const ids = new Set<string>();
  const availableIds = new Set<string>();
  const pending: Promise<void>[] = [];
  if (!Array.isArray(parsed.entries)) errors.push("manifest.json.entries: an array is required.");
  else if (parsed.entries.length === 0) warnings.push("manifest.json.entries: no artwork is curated yet; selection remains disabled until reviewed entries are added.");
  else parsed.entries.forEach((raw, index) => {
    const entry = validateEntry(raw, index, root, collectionIds, errors, pending, verifyFiles);
    if (!entry) return;
    const key = `${entry.id}@${entry.version}`;
    if (identities.has(key)) errors.push(`entries[${index}]: duplicate catalog identity ${key}.`);
    identities.add(key);
    const lifecycle = isRecord(entry.lifecycle) ? entry.lifecycle : null;
    if (typeof entry.id === "string") {
      if (ids.has(entry.id) && lifecycle?.state === "available") errors.push(`entries[${index}]: only one available version may use catalog ID ${entry.id}.`);
      ids.add(entry.id);
      if (lifecycle?.state === "available") {
        if (availableIds.has(entry.id)) errors.push(`entries[${index}]: duplicate available catalog ID ${entry.id}.`);
        availableIds.add(entry.id);
      }
    }
    entries.push(entry as unknown as StockArtManifestEntry);
  });

  await Promise.all(pending);
  for (const [index, entry] of entries.entries()) {
    const replacement = entry.lifecycle?.replacementEntryId;
    if (replacement && (!ids.has(replacement) || replacement === entry.id)) errors.push(`entries[${index}].lifecycle.replacementEntryId: reference a different catalog entry.`);
    if (!hasApprovedStockReview(entry)) warnings.push(`entries[${index}]: human review is pending; production selection is disabled.`);
  }

  const catalog: StockArtCatalog = {
    schemaVersion: STOCK_ART_SCHEMA_VERSION,
    catalogRevision: typeof parsed.catalogRevision === "string" ? parsed.catalogRevision : "",
    collections,
    entries,
  };

  if (verifyFiles) {
    await Promise.all(entries.map(async (entry, index) => {
      const prefix = `entries[${index}]`;
      await Promise.all([
        validateImageFile(root, entry.files?.image, { sha256: entry.derivatives?.imageSha256, width: entry.derivatives?.width, height: entry.derivatives?.height, byteSize: entry.derivatives?.byteSize }, MAX_IMAGE_BYTES, errors, `${prefix}.files.image`),
        validateImageFile(root, entry.files?.thumbnail, { sha256: entry.derivatives?.thumbnailSha256, width: entry.derivatives?.thumbnail?.width, height: entry.derivatives?.thumbnail?.height, byteSize: entry.derivatives?.thumbnail?.byteSize }, MAX_STOCK_ART_THUMBNAIL_BYTES, errors, `${prefix}.files.thumbnail`),
      ]);
    }));
  }

  return { ok: errors.length === 0, errors, warnings, catalog, manifestDigest };
}

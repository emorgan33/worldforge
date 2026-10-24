import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { hasApprovedStockReview, provenanceVerificationOrigin, validateImportedStockSnapshot } from "../src/lib/stock-provenance";
import { ReaderAdjacentCredit, ReaderImageCredits } from "../src/components/public/ReaderImageCredits";
import { PublicRichText } from "../src/components/public/PublicRichText";
import type { ReaderCredit } from "../src/lib/stock-credits";

function snapshot() {
  return {
    id: "moss-gate", version: 1, title: "Moss gate",
    rights: { reviewStatus: "approved", evidence: { reviewer: "Fixture Reviewer", reviewedAt: "2026-10-23" } },
    attribution: { required: true, placement: "adjacent", creditText: "Fixture Artist, CC0", licenseUrl: "https://example.com/license" },
  };
}

test("imported provenance requires matching identity and usable, safe attribution", () => {
  assert.doesNotThrow(() => validateImportedStockSnapshot(JSON.stringify(snapshot()), "moss-gate", 1));
  const variants: unknown[] = ["not JSON", {}, { ...snapshot(), id: "other" }, { ...snapshot(), version: 2 },
    { ...snapshot(), attribution: {} },
    { ...snapshot(), attribution: { ...snapshot().attribution, creditText: "" } },
    { ...snapshot(), attribution: { ...snapshot().attribution, licenseUrl: "javascript:alert(1)" } },
    { ...snapshot(), attribution: { ...snapshot().attribution, sourceUrl: "data:text/plain,unsafe" } },
    { ...snapshot(), source: { itemUrl: "javascript:alert(1)" } },
    { ...snapshot(), creator: { url: "data:text/plain,unsafe" } },
  ];
  for (const variant of variants) {
    const raw = typeof variant === "string" ? variant : JSON.stringify(variant);
    assert.throws(() => validateImportedStockSnapshot(raw, "moss-gate", 1), /provenance snapshot/);
  }
});

test("review approval is explicit and imported claims never become bundled reviews", () => {
  const approved = snapshot();
  assert.equal(hasApprovedStockReview(approved), true);
  assert.equal(provenanceVerificationOrigin("BUNDLED_REVIEW", JSON.stringify(approved)), "BUNDLED_REVIEW");
  assert.equal(provenanceVerificationOrigin("IMPORTED_DECLARATION", JSON.stringify(approved)), "IMPORTED_DECLARATION");
  assert.equal(provenanceVerificationOrigin("PENDING_REVIEW", JSON.stringify(approved)), "PENDING_REVIEW");
  for (const rights of [{}, { ...approved.rights, reviewStatus: "pending" }, { ...approved.rights, evidence: { reviewer: "PENDING HUMAN REVIEW", reviewedAt: "2026-10-23" } }]) {
    const raw = JSON.stringify({ ...approved, rights });
    assert.equal(provenanceVerificationOrigin("BUNDLED_REVIEW", raw), "PENDING_REVIEW");
  }
  assert.equal(provenanceVerificationOrigin("BUNDLED_REVIEW", "not JSON"), "PENDING_REVIEW");
});

test("reader attribution includes links, modifications, and every adjacent requirement", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const credits: ReaderCredit[] = [
    { assetId: id, title: "Gate", creditText: "First credit", placement: "adjacent", verificationOrigin: "IMPORTED_DECLARATION", creatorUrl: "https://example.com/creator", sourceUrl: "https://example.com/source", licenseUrl: "https://example.com/license", modificationNotice: "Cropped to a banner." },
    { assetId: id, title: "Gate", creditText: "Second credit", placement: "adjacent", verificationOrigin: "PENDING_REVIEW" },
  ];
  const section = renderToStaticMarkup(<ReaderImageCredits credits={credits} />);
  assert.match(section, /Artwork credits/);
  for (const value of ["First credit", "Second credit", "Cropped to a banner.", 'href="https://example.com/creator"', 'href="https://example.com/source"', 'href="https://example.com/license"']) assert(section.includes(value));
  const adjacent = renderToStaticMarkup(<ReaderAdjacentCredit credits={credits} assetId={id} />);
  assert(adjacent.includes("First credit") && adjacent.includes("Second credit"));
  const body = renderToStaticMarkup(<PublicRichText doc={{ type: "doc", content: [{ type: "image", attrs: { src: `/api/assets/${id}/file`, alt: "Stone gate" } }] }} links={[]} blocks={[]} credits={credits} />);
  assert.match(body, /alt="Stone gate"/);
  assert(body.includes("First credit") && body.includes("Second credit"));
});

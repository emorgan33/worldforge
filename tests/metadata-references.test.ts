import assert from "node:assert/strict";
import { test } from "node:test";
import { getArticleTemplate } from "../src/lib/templates";
import { metadataReferenceKind, projectReaderMetadata, remapArticleMetadata, validateMetadataReferences } from "../src/lib/metadata-references";

test("metadata reference definitions distinguish scalar, article, block and list fields", () => {
  assert.equal(metadataReferenceKind("linkedLocation"), "article");
  assert.equal(metadataReferenceKind("previousPlot"), "article");
  assert.equal(metadataReferenceKind("linkedLocations"), "article-list");
  assert.equal(metadataReferenceKind("dnd5eParticipant6"), "statblock");
  assert.equal(metadataReferenceKind("pf2eStatblockId"), "statblock");
  for (const key of ["COCStatblockId", "FATEStatblockId", "CUSTOMStatblockId"]) assert.equal(metadataReferenceKind(key), "statblock");
  assert.equal(metadataReferenceKind("location"), "scalar");
  assert.equal(metadataReferenceKind("dnd5eParticipant7"), "scalar");
});

test("reference validation rejects structured values only for known reference fields", () => {
  for (const [key, value] of [["linkedLocation", []], ["linkedEncounters", {}], ["dnd5eParticipant1", {}], ["COCStatblockId", []]] as const) {
    const error = validateMetadataReferences({ [key]: value });
    assert.ok(error);
    assert.match(error, new RegExp(`${key} must be a string reference`));
  }
  assert.equal(validateMetadataReferences({ linkedLocation: "article-id", linkedEncounters: "a\nb", extension: { retained: true } }), null);
  assert.equal(validateMetadataReferences([]), "Article metadata must be an object.");
});

test("reader projection allowlists active fields and removes inaccessible article and statblock IDs", () => {
  const template = getArticleTemplate("ENCOUNTER", "DND_5E");
  const raw = {
    rulesSystem: "PF_2E",
    linkedLocation: "readable-location",
    linkedPlot: "private-plot",
    linkedSession: "readable-session",
    dnd5eParticipant1: "readable-block",
    dnd5eParticipant2: "private-block",
    dnd5eStatblockId: "readable-block",
    privateExtension: "do not project",
  };

  assert.deepEqual(projectReaderMetadata(raw, template, "DND_5E", new Set([
    "readable-location", "readable-session",
  ]), new Set(["readable-block"])), {
    linkedLocation: "readable-location",
    linkedPlot: "",
    linkedSession: "readable-session",
    dnd5eParticipant1: "readable-block",
    dnd5eParticipant2: "",
    rulesSystem: "DND_5E",
  });

  const report = getArticleTemplate("REPORT", "DND_5E");
  assert.equal(projectReaderMetadata({
    linkedEncounters: "readable-encounter\nprivate-encounter\nreadable-encounter-2",
  }, report, "DND_5E", new Set(["readable-encounter", "readable-encounter-2"]), new Set()).linkedEncounters,
  "readable-encounter\nreadable-encounter-2");
});

test("metadata remapping updates known references, clears unavailable references and preserves extensions", () => {
  const missing: Array<[string, string, string]> = [];
  const remapped = remapArticleMetadata(JSON.stringify({
    linkedLocation: "old-location",
    linkedPlot: "missing-plot",
    linkedLocations: "old-location\nmissing-location\nold-location-2",
    pf2eParticipant1: "old-block",
    pf2eStatblockId: "missing-block",
    unknownExtension: "keep this value",
    nestedExtension: { opaque: true },
  }), new Map([["old-location", "new-location"], ["old-location-2", "new-location-2"]]), new Map([["old-block", "new-block"]]),
  (key, id, kind) => missing.push([key, id, kind]));

  assert.deepEqual(JSON.parse(remapped!), {
    linkedLocation: "new-location",
    linkedPlot: "",
    linkedLocations: "new-location\nnew-location-2",
    pf2eParticipant1: "new-block",
    pf2eStatblockId: "",
    unknownExtension: "keep this value",
    nestedExtension: { opaque: true },
  });
  assert.deepEqual(missing, [
    ["linkedPlot", "missing-plot", "article"],
    ["linkedLocations", "missing-location", "article"],
    ["pf2eStatblockId", "missing-block", "statblock"],
  ]);
});

test("malformed metadata remains unchanged", () => {
  assert.equal(remapArticleMetadata("not-json", new Map(), new Map()), "not-json");
  assert.equal(remapArticleMetadata(null, new Map(), new Map()), null);
  assert.deepEqual(JSON.parse(remapArticleMetadata(JSON.stringify({ linkedLocation: [], extension: { retained: true } }), new Map(), new Map())!), {
    linkedLocation: "",
    extension: { retained: true },
  });
});

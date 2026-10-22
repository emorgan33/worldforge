import assert from "node:assert/strict";
import { test } from "node:test";
import { characterRowsKey, characterSheetDefinition, dndAbilityModifier, readCharacterRows, readerCharacterRows, updateCharacterRows, validateCharacterRows } from "../src/lib/character-sheet";
import { getArticleTemplate, validateTemplateMetadata } from "../src/lib/templates";
import { articleFacts } from "../src/lib/article-template-content";
import { parseArticleDraft } from "../src/lib/article-drafts";

test("existing character fields feed the sheet without converting or replacing saved data", () => {
  const legacy = { species: "Elf", dnd5eClass: "Wizard / evoker", dnd5eCharacterLevel: "Veteran", dnd5eProficiency: "+4", dnd5eBond: "Protect the library", pf2eHeritage: "Ancient elf", pf2ePerception: "+11", customNote: "Retain this" };
  for (const system of ["DND_5E", "PF_2E"] as const) {
    const template = getArticleTemplate("CHARACTER", system);
    assert.equal(new Set(template.fields.map(field => field.key)).size, template.fields.length);
    assert.equal(validateTemplateMetadata(template, legacy, legacy), null);
    const facts = articleFacts(template, legacy);
    assert(facts.groups.flatMap(group => group.fields).some(field => field.key === "species" && field.value === "Elf"));
    assert(facts.other.some(field => field.key === "customNote"));
    const active = characterSheetDefinition(system).sections.flatMap(section => section.fields.map(field => field.key));
    for (const key of system === "DND_5E" ? ["dnd5eClass", "dnd5eCharacterLevel", "dnd5eProficiency", "dnd5eBond"] : ["pf2eHeritage", "pf2ePerception"]) assert(active.includes(key));
  }
  assert.equal(legacy.dnd5eCharacterLevel, "Veteran");
});

test("sheet numbers allow blank, zero and Remaster negatives, while enforcing edition-specific ranges", () => {
  const dnd = getArticleTemplate("CHARACTER", "DND_5E");
  const pf = getArticleTemplate("CHARACTER", "PF_2E");
  assert.equal(validateTemplateMetadata(dnd, { dnd5eSTR: "10", dnd5eCurrentHp: "0", dnd5eTemporaryHp: "" }), null);
  assert(validateTemplateMetadata(dnd, { dnd5eSTR: "-1" }));
  assert.equal(validateTemplateMetadata(pf, { pf2eSTR: "-1", pf2eCurrentHp: "0" }), null);
  assert(validateTemplateMetadata(pf, { pf2eHeroPoints: "4" }));
  assert(validateTemplateMetadata(dnd, { dnd5eDeathSuccesses: "4" }));
  assert.equal(dndAbilityModifier("8"), "-1");
  assert.equal(dndAbilityModifier("15"), "+2");
  assert.equal(dndAbilityModifier(""), "—");
  assert.equal(dndAbilityModifier("Legacy note"), "—");
});

test("repeatable edits retain other sections and extension data, and cleared rows stay cleared", () => {
  const original = JSON.stringify({ version: 1, extension: "retain", sections: { attacks: [{ id: "a", name: "Longsword", extra: "keep" }], spells: [{ id: "s", name: "Light" }] } });
  const { data, error } = readCharacterRows(original);
  assert.equal(error, undefined);
  const changed = updateCharacterRows(data, "attacks", [{ ...data.sections.attacks[0], name: "" }]);
  assert.equal(JSON.parse(changed).extension, "retain");
  assert.deepEqual(readCharacterRows(changed).data.sections.spells, data.sections.spells);
  assert.equal(readCharacterRows(changed).data.sections.attacks[0].extra, "keep");
  const removed = updateCharacterRows(readCharacterRows(changed).data, "attacks", []);
  assert.deepEqual(readCharacterRows(removed).data.sections.attacks, []);
  assert.equal(data.sections.attacks[0].name, "Longsword");
});

test("readers receive only active-profile rows and known columns, never extension data or raw JSON facts", () => {
  const metadata = {
    dnd5eCharacterRows: JSON.stringify({ version: 1, secret: "top secret", sections: { attacks: [{ id: "a", name: "Bow", secret: "hidden" }], privateNotes: [{ id: "n", name: "GM only" }] } }),
    pf2eCharacterRows: JSON.stringify({ version: 1, sections: { spells: [{ id: "s", name: "Other profile secret" }] } }),
    rulesSystem: "DND_5E", unknown: "other value",
  };
  const projected = readerCharacterRows("DND_5E", metadata);
  assert.deepEqual(Object.keys(projected), ["dnd5eCharacterRows"]);
  assert.deepEqual(readCharacterRows(projected.dnd5eCharacterRows).data.sections.attacks, [{ id: "a", name: "Bow" }]);
  assert.doesNotMatch(JSON.stringify(projected), /secret|hidden|GM only|Other profile/);
  assert.deepEqual(readerCharacterRows("CUSTOM", metadata), {});
  const facts = articleFacts(getArticleTemplate("CHARACTER", "DND_5E"), metadata);
  assert.deepEqual(facts.other.map(field => field.key), ["unknown"]);
});

test("malformed and newer row data cannot be overwritten through normal sheet editing", () => {
  for (const raw of ["broken", "null", "[]", '{"version":2,"sections":{}}', '{"version":1,"sections":[]}', '{"version":1,"sections":{"attacks":[{"id":"x","name":5}]}}', '{"version":1,"sections":{"attacks":[{"id":"x"},{"id":"x"}]}}']) {
    assert(readCharacterRows(raw).error);
    assert(validateCharacterRows({ dnd5eCharacterRows: raw }));
    assert.equal(validateCharacterRows({ dnd5eCharacterRows: raw }, { dnd5eCharacterRows: raw }), null);
    assert.deepEqual(readerCharacterRows("DND_5E", { dnd5eCharacterRows: raw }), {});
  }
  assert.deepEqual(readCharacterRows(undefined).data.sections, {});
});

test("local recovery preserves both profiles, empty values and all repeatable sections", () => {
  const metadata: Record<string, string> = { rulesSystem: "PF_2E", dnd5eCurrentHp: "0", pf2eSTR: "-1", pf2eClass: "" };
  for (const system of ["DND_5E", "PF_2E"] as const) metadata[characterRowsKey(system)] = JSON.stringify({ version: 1, sections: Object.fromEntries(characterSheetDefinition(system).rows.map(section => [section.key, [{ id: section.key, name: "Saved entry" }]])) });
  const draft = { version: 1, data: { worldId: "w", template: "CHARACTER", title: "Ari", categoryId: null, excerpt: "", tags: "", state: "DRAFT", contentHtml: "<p>Original prose</p>", metadata } };
  assert.deepEqual(parseArticleDraft(JSON.stringify(draft), "w")?.data.metadata, metadata);
});

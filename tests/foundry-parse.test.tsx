import test from "node:test";
import assert from "node:assert/strict";
import { parseFoundrySources } from "../src/lib/foundry/parse";

// Synthetic schema-shape inputs. Version labels match the requested provisional gate; no real export compatibility is implied.
const metadata = { system: "pf2e", systemVersion: "8.6.1", foundryVersion: "14.369", remaster: true, namespace: "campaign-a" };
const item = (overrides: Record<string, unknown> = {}) => ({
  _id: "healing-potion", type: "consumable", name: "Healing Potion", img: "systems/pf2e/icons/default-icons/consumable.svg",
  system: { level: { value: 1 }, traits: { rarity: "common", value: ["healing", "consumable"] }, description: { value: "<p>Restore <strong>1d8 HP</strong>.</p><script>alert(1)</script>" }, price: { value: { gp: 4 } }, rules: [{ key: "GrantItem" }] },
  ...overrides,
});

test("parses exported Foundry item and creates namespaced identity and digest", () => {
  const [candidate] = parseFoundrySources([{ name: "potion.json", text: JSON.stringify(item()) }], metadata);
  assert.equal(candidate.name, "Healing Potion");
  assert.equal(candidate.category, "ITEM");
  assert.equal(candidate.supported, true);
  assert.equal(candidate.sourceIdentity, '["campaign-a","healing-potion"]');
  assert.match(candidate.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(String(candidate.stats.description), /Restore 1d8 HP/);
  assert.doesNotMatch(String(candidate.stats.description), /script|alert/);
  assert.ok(candidate.warnings.some(w => w.includes("image path")));
  assert.ok(candidate.warnings.some(w => w.includes("automation")));
});

test("accepts export arrays and preserves unsupported entries as disabled candidates", () => {
  const [weapon, actor] = parseFoundrySources([{ name: "items.json", text: JSON.stringify([item({ type: "weapon" }), item({ _id: "actor", type: "action" })]) }], metadata);
  assert.equal(weapon.supported, true);
  assert.equal(actor.supported, false);
  assert.ok(actor.warnings.length);
});

test("maps spell rank and feat preview fields explicitly", () => {
  const spellDoc = item({ _id: "spell", type: "spell", name: "Synthetic Fire", system: {
    level: { value: 4, rank: 4 }, traits: { rarity: "uncommon", value: ["fire"] }, description: { value: "@UUID[Compendium.pf2e.spells.Item.fire]{Fire spell} [[/r 1d6]]" },
    traditions: { value: ["arcane"] }, range: { value: "30 feet" },
  } });
  const featDoc = item({ _id: "feat", type: "feat", name: "Synthetic Feat", system: {
    level: { value: 2 }, traits: { rarity: "common", value: ["skill"] }, description: { value: "A synthetic feat." },
    actionCost: { value: "2" }, prerequisites: { value: "Trained in Arcana" }, frequency: { value: "once per day" },
  } });
  const [spell, feat] = parseFoundrySources([{ name: "synthetic-shapes.json", text: JSON.stringify([spellDoc, featDoc]) }], metadata);
  assert.equal(spell.category, "SPELL");
  assert.equal(spell.level, "4");
  assert.equal(spell.stats.rank, "4");
  assert.equal(spell.stats.traditions, "arcane");
  assert.match(String(spell.stats.description), /Fire spell/);
  assert.match(String(spell.stats.description), /Roll: 1d6/);
  assert.equal(feat.category, "FEAT");
  assert.equal(feat.stats.actionCost, "2");
  assert.equal(feat.stats.prerequisites, "Trained in Arcana");
  assert.equal(feat.stats.frequency, "once per day");
});

test("rejects embedded source version conflicts and actor-owned compendium sources", () => {
  const [mismatch] = parseFoundrySources([{ name: "source.json", text: JSON.stringify(item({ _stats: { systemId: "pf2e", systemVersion: "8.5.0", coreVersion: "14.369" } })) }], metadata);
  assert.equal(mismatch.supported, false);
  assert.ok(mismatch.warnings.some(w => w.includes("conflicts")));
  const [actorOwned] = parseFoundrySources([{ name: "source.json", text: JSON.stringify(item({ _stats: { compendiumSource: "Actor.abc.Item.def" } })) }], metadata);
  assert.equal(actorOwned.supported, false);
  assert.ok(actorOwned.warnings.some(w => w.includes("Actor-owned")));
});

test("legacy markers and non-Remaster declaration prevent import", () => {
  const [notDeclared] = parseFoundrySources([{ name: "item.json", text: JSON.stringify(item()) }], { ...metadata, remaster: false });
  assert.equal(notDeclared.supported, false);
  const [legacy] = parseFoundrySources([{ name: "item.json", text: JSON.stringify(item({ flags: { pf2e: { legacy: true } } })) }], metadata);
  assert.equal(legacy.supported, false);
});

test("versions outside the provisional gate stay visible but unsupported", () => {
  const [candidate] = parseFoundrySources([{ name: "item.json", text: JSON.stringify(item()) }], { ...metadata, systemVersion: "8.5.0" });
  assert.equal(candidate.supported, false);
  assert.ok(candidate.warnings.some(w => w.includes("compatibility still requires representative real exports")));
});

test("rejects malformed inputs, missing versions, other systems, and over-limit documents", () => {
  assert.throws(() => parseFoundrySources([{ name: "bad.json", text: "{" }], metadata), /valid JSON/);
  assert.throws(() => parseFoundrySources([{ name: "ok.json", text: JSON.stringify(item()) }], { ...metadata, systemVersion: "" }), /versions are required/);
  assert.throws(() => parseFoundrySources([{ name: "ok.json", text: JSON.stringify(item()) }], { ...metadata, system: "dnd5e" }), /pf2e system only/);
  assert.throws(() => parseFoundrySources([{ name: "big.json", text: JSON.stringify(item({ system: { description: { value: "x".repeat(1024 * 1024) } } })) }], metadata), /1 MB/);
});

test("uses namespace in stable identity and sanitizes Foundry markup as readable text", () => {
  const source = JSON.stringify(item({ system: { description: { value: "@Check[flat|dc:15]{DC 15 flat check} [[/r 1d6]]" } } }));
  const [a] = parseFoundrySources([{ name: "a.json", text: source }], metadata);
  const [b] = parseFoundrySources([{ name: "a.json", text: source }], { ...metadata, namespace: "campaign-b" });
  assert.notEqual(a.sourceIdentity, b.sourceIdentity);
  assert.match(String(a.stats.description), /DC 15 flat check/);
  assert.ok(a.warnings.some(w => w.includes("remain unresolved")));
  assert.match(String(a.stats.description), /DC 15 flat check/);
  assert.match(String(a.stats.description), /Roll: 1d6/);
});

test("bounds candidate count and rejects duplicate source IDs", () => {
  const docs = Array.from({ length: 1000 }, (_, i) => item({ _id: `item-${i}` }));
  assert.equal(parseFoundrySources([{ name: "thousand.json", text: JSON.stringify(docs) }], metadata).length, 1000);
  assert.throws(() => parseFoundrySources([{ name: "too-many.json", text: JSON.stringify([...docs, item({ _id: "extra" })]) }], metadata), /1,000 documents/);
  assert.throws(() => parseFoundrySources([{ name: "duplicates.json", text: JSON.stringify([item(), item()]) }], metadata), /duplicate source identities/);
});

test("fallback identities use content and namespace, so changed anonymous documents do not collide", () => {
  const noId = (description: string) => ({ name: "Anonymous", type: "equipment", system: { description: { value: description } } });
  const [first, changed] = parseFoundrySources([{ name: "anonymous.json", text: JSON.stringify([noId("one"), noId("two")]) }], metadata);
  assert.notEqual(first.sourceIdentity, changed.sourceIdentity);
  assert.equal(first.supported, false);
  assert.equal(changed.supported, false);
  assert.ok(first.warnings.some(w => w.includes("no stable Foundry UUID or ID")));
});

test("Actor exports never unwrap embedded inventory into importable items", () => {
  const actor = { _id: "actor-id", type: "character", name: "Actor", system: {}, items: [item()] };
  const candidates = parseFoundrySources([{ name: "actor.json", text: JSON.stringify(actor) }], metadata);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].supported, false);
  assert.equal(candidates[0].name, "Actor");
});

test("same-name documents with distinct source IDs remain distinct", () => {
  const candidates = parseFoundrySources([{ name: "items.json", text: JSON.stringify([item({ _id: "one" }), item({ _id: "two" })]) }], metadata);
  assert.equal(candidates.length, 2);
  assert.notEqual(candidates[0].sourceIdentity, candidates[1].sourceIdentity);
  assert.ok(candidates.every(candidate => candidate.supported));
});

test("unlabeled Foundry UUID markup keeps a readable reference fallback", () => {
  const source = JSON.stringify(item({ system: { description: { value: "@UUID[Compendium.pf2e.spells.Item.fire]" } } }));
  const [candidate] = parseFoundrySources([{ name: "reference.json", text: source }], metadata);
  assert.match(String(candidate.stats.description), /Compendium.pf2e.spells.Item.fire/);
});

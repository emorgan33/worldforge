import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryAncestors, categoryMovePlan, categoryOptions, categoryPathLabel, descendantIds } from "../src/lib/category-tree";

const categories = [
  { id: "people", name: "People", parentId: null, order: 0 },
  { id: "atlas", name: "Atlas", parentId: null, order: 1 },
  { id: "cities", name: "Cities", parentId: "atlas", order: 0 },
  { id: "districts", name: "Districts", parentId: "cities", order: 0 },
];
test("category paths reflect nested order and include empty folders", () => {
  assert.deepEqual(categoryOptions(categories), [
    { id: "people", label: "People" }, { id: "atlas", label: "Atlas" },
    { id: "cities", label: "Atlas / Cities" }, { id: "districts", label: "Atlas / Cities / Districts" },
  ]);
});
test("category moves reject self-parenting, descendant cycles and foreign destinations", () => {
  assert.throws(() => categoryMovePlan(categories, "atlas", "districts"), /descendants/);
  assert.throws(() => categoryMovePlan(categories, "atlas", "atlas"), /itself/);
  assert.throws(() => categoryMovePlan(categories, "atlas", "other-world"), /not found/);
  assert.throws(() => categoryMovePlan(categories, "people", null, "cities"), /reorder target/);
});
test("reparenting preserves descendants and normalizes both sibling groups", () => {
  const plan = categoryMovePlan(categories, "cities", "people");
  assert.deepEqual(plan, [{ id: "cities", parentId: "people", order: 0 }]);
  const after = categories.map(category => ({ ...category, ...plan.find(update => update.id === category.id) }));
  assert.deepEqual(categoryOptions(after).map(option => option.label), ["People", "People / Cities", "People / Cities / Districts", "Atlas"]);
  assert.deepEqual([...descendantIds(after, "people")], ["people", "cities", "districts"]);
});
test("category reorder plans persist first/last positions without duplicates", () => {
  const plan = categoryMovePlan(categories, "atlas", null, "people");
  assert.deepEqual(plan, [{ id: "atlas", parentId: null, order: 0 }, { id: "people", parentId: null, order: 1 }]);
  assert.deepEqual(categoryMovePlan(categories, "atlas", null, "atlas"), []);
});

test("categoryAncestors returns root-to-parent lineage and handles null / missing / cycles", () => {
  assert.deepEqual(categoryAncestors(categories, null), []);
  assert.deepEqual(categoryAncestors(categories, "missing"), []);
  assert.deepEqual(
    categoryAncestors(categories, "districts").map(c => c.id),
    ["atlas", "cities", "districts"]
  );
  assert.deepEqual(
    categoryAncestors(categories, "cities").map(c => c.id),
    ["atlas", "cities"]
  );
  assert.deepEqual(
    categoryAncestors(categories, "people").map(c => c.id),
    ["people"]
  );

  // Self cycle or mutual loop should not infinite loop
  const cyclic = [
    { id: "loopA", name: "Loop A", parentId: "loopB", order: 0 },
    { id: "loopB", name: "Loop B", parentId: "loopA", order: 0 },
  ];
  const lineage = categoryAncestors(cyclic, "loopA");
  assert.equal(lineage.length, 2);
});

test("categoryPathLabel distinguishes nested folders from uncategorized articles", () => {
  assert.equal(categoryPathLabel(categories, "districts"), "Atlas / Cities / Districts");
  assert.equal(categoryPathLabel(categories, null), "Uncategorized");
});


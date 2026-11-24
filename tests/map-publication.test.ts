import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMapSnapshot,
  normalizeSelection,
  parseMapSnapshot,
  snapshotImageReferences,
  snapshotSelection,
  type PublicationSource,
} from "../src/lib/map-publication";

const source: PublicationSource = {
  title: "The Shattered Coast",
  description: "Published selection",
  imageUrl: "/api/assets/00000000-0000-4000-8000-000000000001/file",
  width: 1920,
  height: 1080,
  defaultZoom: 1,
  layers: [
    { id: "coast", name: "Coast", order: 0, imageUrl: null },
    { id: "secret", name: "Secret", order: 1, imageUrl: null },
  ],
  markers: [
    { id: "harbor", layerId: "coast", title: "Harbor", description: "Safe port", x: 40, y: 55, icon: "flag", color: "#3b82f6", articleId: "article-1" },
    { id: "vault", layerId: "secret", title: "Hidden vault", x: 10, y: 10, icon: "gem", color: "#ef4444", articleId: null },
    { id: "camp", layerId: null, title: "Camp", x: 20, y: 30, icon: "home", color: "#22c55e", articleId: null },
  ],
  elements: [
    { id: "label", layerId: null, kind: "LABEL", geometry: JSON.stringify({ x: 5, y: 5, text: "North" }), style: JSON.stringify({ color: "#eab308" }), order: 0 },
    { id: "route", layerId: "coast", kind: "PATH", geometry: JSON.stringify({ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }), style: JSON.stringify({ color: "#f8fafc" }), order: 1 },
    { id: "trap", layerId: "secret", kind: "CIRCLE", geometry: JSON.stringify({ x1: 1, y1: 1, x2: 2, y2: 2 }), style: null, order: 2 },
  ],
};

test("a publication keeps only the selected layers and their selected children", () => {
  const snapshot = buildMapSnapshot(source, { layers: ["coast"], markers: ["harbor", "vault", "camp"], elements: ["label", "route", "trap"] });
  assert.deepEqual(snapshot.layers.map(layer => layer.id), ["coast"]);
  assert.deepEqual(snapshot.markers.map(marker => marker.id), ["harbor", "camp"], "pins on unpublished layers must not leak");
  assert.deepEqual(snapshot.elements.map(element => element.id), ["label", "route"], "annotations on unpublished layers must not leak");
  assert.equal(snapshot.markers[0].articleId, "article-1");
});

test("nothing is published unless it is selected", () => {
  const snapshot = buildMapSnapshot(source, { layers: [], markers: [], elements: [] });
  assert.deepEqual(snapshot.layers, []);
  assert.deepEqual(snapshot.markers, []);
  assert.deepEqual(snapshot.elements, []);
});

test("selection input is deduplicated, bounded and validated", () => {
  assert.deepEqual(normalizeSelection({ layers: ["a", "a", "b"], markers: [], elements: undefined }), { layers: ["a", "b"], markers: [], elements: [] });
  assert.throws(() => normalizeSelection({ layers: [42] }), /valid map items/);
  assert.throws(() => normalizeSelection({ layers: ["../etc/passwd"] }), /valid map items/);
});

test("a snapshot round-trips through storage and yields its selection", () => {
  const snapshot = buildMapSnapshot(source, { layers: ["coast"], markers: ["harbor"], elements: ["route"] });
  const parsed = parseMapSnapshot(JSON.stringify(snapshot));
  assert.deepEqual(parsed, snapshot);
  assert.deepEqual(snapshotSelection(parsed!), { layers: ["coast"], markers: ["harbor"], elements: ["route"] });
  assert.deepEqual(snapshotImageReferences(parsed!), [source.imageUrl]);
});

test("malformed snapshots are rejected instead of partially rendered", () => {
  assert.equal(parseMapSnapshot(null), null);
  assert.equal(parseMapSnapshot("{"), null);
  assert.equal(parseMapSnapshot(JSON.stringify({ ...buildMapSnapshot(source, { layers: ["coast"], markers: [], elements: [] }), version: 2 })), null);
  const snapshot = buildMapSnapshot(source, { layers: ["coast"], markers: ["harbor"], elements: [] });
  const broken = JSON.parse(JSON.stringify(snapshot));
  broken.markers[0].x = 240;
  assert.equal(parseMapSnapshot(JSON.stringify(broken)), null, "out-of-range coordinates are rejected");
  const orphan = JSON.parse(JSON.stringify(snapshot));
  orphan.markers[0].layerId = "missing-layer";
  assert.equal(parseMapSnapshot(JSON.stringify(orphan)), null, "markers cannot reference an unpublished layer");
});

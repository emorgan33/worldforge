import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InteractiveMap, type MapData } from "@/components/map/InteractiveMap";

const emptyMutate = async () => ({});

test("map editor empty state invites creating a first map", () => {
  const html = renderToStaticMarkup(<InteractiveMap maps={[]} worldId="world-1" onMutate={emptyMutate} />);
  assert.match(html, /No maps yet/);
  assert.match(html, /Create your first map/);
  assert.match(html, /New map/);
});

test("map editor lists maps and drawing tools", () => {
  const map: MapData = {
    id: "map-1",
    worldId: "world-1",
    title: "The Shattered Coast",
    imageUrl: "https://example.invalid/map.webp",
    width: 1920,
    height: 1080,
    layers: [{ id: "layer-1", mapId: "map-1", name: "Cities", order: 0, isVisible: true }],
    markers: [{ id: "pin-1", mapId: "map-1", title: "Harbor", x: 40, y: 55, color: "#3b82f6", icon: "map-pin" }],
    elements: [{ id: "el-1", mapId: "map-1", kind: "LABEL", geometry: JSON.stringify({ x: 12, y: 18, text: "North Watch" }), style: JSON.stringify({ color: "#eab308" }) }],
  };
  const html = renderToStaticMarkup(<InteractiveMap maps={[map]} worldId="world-1" onMutate={emptyMutate} />);
  assert.match(html, /The Shattered Coast/);
  assert.match(html, /Harbor/);
  assert.match(html, /North Watch/);
  assert.match(html, /Pin/);
  assert.match(html, /Freehand/);
  assert.match(html, /Rectangle/);
  assert.match(html, /Eraser/);
  assert.match(html, /hold Shift for a square/);
  assert.match(html, /Layers/);
});

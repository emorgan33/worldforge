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

test("map editor renders drawings and hides annotations on hidden layers", () => {
  const map: MapData = {
    id: "map-2",
    worldId: "world-1",
    title: "Ink and parchment",
    imageUrl: "https://example.invalid/map.webp",
    width: 1600,
    height: 900,
    layers: [
      { id: "ink", mapId: "map-2", name: "Ink", order: 0, isVisible: true },
      { id: "hidden", mapId: "map-2", name: "Hidden", order: 1, isVisible: false },
    ],
    markers: [],
    elements: [
      { id: "line", mapId: "map-2", layerId: "ink", kind: "LINE", geometry: JSON.stringify({ x1: 5, y1: 6, x2: 35, y2: 36 }), style: JSON.stringify({ color: "#ef4444", strokeWidth: 3 }) },
      { id: "circle", mapId: "map-2", layerId: "ink", kind: "CIRCLE", geometry: JSON.stringify({ x1: 50, y1: 50, x2: 60, y2: 70 }), style: JSON.stringify({ color: "#3b82f6", strokeWidth: 2 }) },
      { id: "rect", mapId: "map-2", layerId: "ink", kind: "RECT", geometry: JSON.stringify({ x1: 11, y1: 21, x2: 40, y2: 40 }), style: JSON.stringify({ color: "#22c55e", strokeWidth: 4 }) },
      { id: "path", mapId: "map-2", layerId: "ink", kind: "PATH", geometry: JSON.stringify({ points: [{ x: 10, y: 70 }, { x: 20, y: 80 }, { x: 30, y: 75 }] }), style: JSON.stringify({ color: "#8b5cf6", strokeWidth: 3 }) },
      { id: "erase", mapId: "map-2", layerId: "ink", kind: "PATH", geometry: JSON.stringify({ points: [{ x: 60, y: 60 }, { x: 61, y: 61 }] }), style: JSON.stringify({ erase: true, strokeWidth: 16 }) },
      { id: "hidden-rect", mapId: "map-2", layerId: "hidden", kind: "RECT", geometry: JSON.stringify({ x1: 70, y1: 70, x2: 80, y2: 80 }), style: JSON.stringify({ color: "#eab308", strokeWidth: 3 }) },
      { id: "hidden-label", mapId: "map-2", layerId: "hidden", kind: "LABEL", geometry: JSON.stringify({ x: 5, y: 5, text: "Hidden Label" }), style: JSON.stringify({ color: "#eab308" }) },
    ],
  };
  const html = renderToStaticMarkup(<InteractiveMap maps={[map]} worldId="world-1" onMutate={emptyMutate} />);
  assert.match(html, /x1="5" y1="6" x2="35" y2="36"/);
  assert.match(html, /cx="50" cy="50" rx="10" ry="20"/);
  assert.match(html, /x="11" y="21" width="29" height="19"/);
  assert.match(html, /points="10,70 20,80 30,75"/);
  assert.doesNotMatch(html, /points="60,60 61,61"/);
  assert.doesNotMatch(html, /x="70" y="70" width="10" height="10"/);
  assert.doesNotMatch(html, /Hidden Label/);
});

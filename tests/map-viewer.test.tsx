import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MapViewer } from "@/components/map/MapViewer";
import type { MapSnapshot } from "@/lib/map-publication";

const snapshot: MapSnapshot = {
  version: 1,
  title: "The Shattered Coast",
  description: "A published player map.",
  imageUrl: "/api/assets/00000000-0000-4000-8000-000000000001/file",
  width: 1920,
  height: 1080,
  defaultZoom: 1,
  layers: [{ id: "coast", name: "Coast", order: 0, imageUrl: null }],
  markers: [
    { id: "harbor", layerId: "coast", title: "Harbor", description: "Safe port", x: 40, y: 55, icon: "flag", color: "#3b82f6", articleId: "article-1" },
    { id: "camp", layerId: null, title: "Camp", description: null, x: 20, y: 30, icon: "home", color: "#22c55e", articleId: null },
  ],
  elements: [
    { id: "label", layerId: null, kind: "LABEL", geometry: JSON.stringify({ x: 8, y: 12, text: "North Watch" }), style: JSON.stringify({ color: "#eab308" }), order: 0 },
  ],
};

test("the player viewer renders only the published snapshot", () => {
  const html = renderToStaticMarkup(<MapViewer snapshot={snapshot} articleLinks={{ harbor: "/c/readers/a/harbor" }} />);
  assert.match(html, /Harbor/);
  assert.match(html, /Camp/);
  assert.match(html, /North Watch/);
  assert.match(html, /Places/);
  assert.match(html, /Zoom in/);
  assert.match(html, /Zoom out/);
  assert.match(html, /Reset view/);
  assert.doesNotMatch(html, /Hidden vault/, "unpublished pins must never reach the player bundle");
  assert.doesNotMatch(html, /\/c\/readers\/a\/harbor/, "article links are revealed only after selecting a pin");
});

test("a map with no published pins invites nothing instead of leaking placeholders", () => {
  const html = renderToStaticMarkup(<MapViewer snapshot={{ ...snapshot, markers: [], elements: [] }} />);
  assert.match(html, /No pins have been shared yet/);
  assert.doesNotMatch(html, /Harbor/);
});

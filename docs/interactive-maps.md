# Interactive maps

The **Interactive maps** view in the author workspace is a GM cartography editor. A world can hold several maps; each map has an image, optional description, layers, pins, text labels, and drawings. Maps are authored and stored per world and are currently author-only; the public and campaign reader views do not project maps yet.

## Creating a map

Open a world, choose **Interactive maps**, then **New map** (or **Create your first map** when the world has none). A map needs a name and an image. Pick an existing image from the embedded **Image library**, which also fills the width and height, or paste an image URL and dimensions manually. **Rename** changes the map title; **Delete** removes the map and its layers, pins, and annotations after confirmation.

The map selector switches between maps in the world. Zoom in, zoom out, and reset view only affect the current view; the saved geometry is independent of zoom.

## Layers

**Layers** opens the layer panel:

- **Add** creates a layer.
- Click a layer name to rename it; press Enter or click away to save.
- The eye button hides or shows the layer.
- Arrow buttons reorder layers; higher rows draw on top.
- **Delete** removes the layer and keeps its pins and drawings, which then show on every layer view.

A pin or annotation without a layer is always visible. Hidden layers hide their markers and annotations on the canvas and from selection.

## Pins and labels

- **Pin** places a marker. In the form, set a title, description, icon, and optional layer. Saved pins can be dragged to a new position.
- **Label** places free text. Set the text, color, font size, and optional layer.
- Select an existing pin or label with **Select** to edit it in the side panel. Pins can also link to an article and open it from the map.

Coordinates are stored as percentages of the map image, so pins and labels stay aligned when the window or zoom changes.

## Drawings and erasing

The drawing tools paint on a transparent canvas over the map:

- **Line** drags from start to end.
- **Circle** draws from the centre outward. Hold **Shift** while dragging for a perfect circle.
- **Rectangle** draws from corner to corner. Hold **Shift** while dragging for a square.
- **Freehand** records a path as the pointer moves.
- **Eraser** is a paint-style eraser: hold the primary button and drag over drawing ink to erase it. Use **Size** to change the brush. It only removes drawings, not pins or labels.

Line, circle, rectangle, and freehand share **Color** and **Stroke** controls. Colors come from a popover with preset swatches and a custom color input.

Drawings and eraser strokes are stored in chronological order and redrawn in that order, so ink added after an erasure remains visible. Erasing is non-destructive in storage: it records an erase stroke instead of deleting the original annotation.

## Persistence and portability

The editor writes through `POST`/`PATCH`/`DELETE /api/maps` using action names such as `createMap`, `createLayer`, `createMarker`, `createElement`, `updateLayer`, `reorderLayer`, and their `delete…` counterparts. The parent workspace derives the HTTP method from the action prefix, injects the world ID, and reloads the world's maps after each write. Requests are owner-scoped through the same world-access checks as other author resources.

Map annotations use the `MapElement` model. Geometry is percentage JSON:

- `LABEL`: `{ "x": 12, "y": 18, "text": "North Watch" }`
- `LINE`, `CIRCLE`, `RECT`: `{ "x1": 10, "y1": 10, "x2": 40, "y2": 30 }`
- `PATH`: `{ "points": [{ "x": 10, "y": 10 }, …] }`

Style is JSON such as `{ "color": "#eab308", "strokeWidth": 3 }` or `{ "color": "#f8fafc", "fontSize": 18 }`. Eraser strokes are `PATH` elements with `{ "erase": true, "strokeWidth": 16 }`. The API validates drawing geometry for `LINE`, `CIRCLE`, `RECT`, and `PATH`, and text for `LABEL`, and rejects unknown annotation kinds.

World export includes maps, layers, pins, marker groups, and elements; import remaps IDs and layer references and warns when an element points at a layer from another map.

## Implementation and verification

The editor lives in `src/components/map/InteractiveMap.tsx`. It owns the tool and layer state, the canvas renderer, and the `NewMapModal`, `LayerPanel`, `SelectionPanel`, `DraggablePin`, and `ColorControl` components. The author workspace wires it up in `src/components/AuthorWorkspace.tsx` (`handleMapMutation`); the API is `src/app/api/maps/route.ts`; ownership resolution is in `src/lib/auth.ts`; export/import is in `src/lib/world-export.ts`.

Canvas rendering uses device-pixel-ratio scaling and a `ResizeObserver`. Ink is painted with `source-over` and eraser strokes with `destination-out`. An invisible SVG layer remains only as the hit target for selecting line, circle, rectangle, and freehand annotations.

Run the focused checks with:

```sh
node --import tsx --test tests/interactive-map.test.tsx tests/world-export-roundtrip.test.tsx
```

The component test renders the empty state and a populated map and asserts the available tools. The export test round-trips a label annotation and verifies layer remapping. The broader suite uses `pnpm test` against an isolated database and asset directory; see [CONTRIBUTING.md](../CONTRIBUTING.md).

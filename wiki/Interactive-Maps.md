# Interactive Maps

Maps are an **author-only GM cartography editor**. Publishing a world or sharing
an article does not expose interactive maps to public or campaign readers.

1. Open **Interactive maps**, then **New map** (or **Create your first map**).
2. Enter a name and choose an image from the Image library; dimensions fill
   automatically. Alternatively supply an image URL and dimensions.
3. Zoom/reset for the current view; saved geometry stays aligned with the image.

## Annotate

- **Pin:** place a marker with title, description, icon, optional layer/article
  link. Drag saved pins to reposition them.
- **Label:** place text with color/font size. Use **Select** to edit pins/labels.
- **Line**, **Circle**, **Rectangle**, **Freehand:** draw with Color/Stroke controls.
  Hold Shift for a circle or square.
- **Eraser:** drag to erase drawing ink; Size controls the brush. It does not
  remove pins or labels. Later ink can be drawn over an erasure.

## Layers and failed saves

Open **Layers** to add, rename, show/hide, reorder, or delete a layer. Hidden
layers hide their pins/drawings. Deleting a layer keeps its annotations as
unlayered; unlayered content always shows. Deleting the map removes its contents
after confirmation, so export/back up first.

Failed drawing saves remain visible with **Retry**/**Discard**. Resolve them
before changing maps or leaving; visible ink is not proof that it was saved.
World export/import preserves map layers, pins, annotations, and drawing order.

**Source owner:** `wiki/Interactive-Maps.md`; implementation:
`docs/interactive-maps.md`, `src/components/map/InteractiveMap.tsx`, map APIs.
**Verified against:** `v0.4.3` (`94c694c`), source/contract audit; see
[verification record](Wiki-Verification).

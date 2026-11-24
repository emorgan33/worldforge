# Interactive Maps

Maps are a GM cartography editor. A GM can publish a **read-only player view** of
chosen map content; the public reader never shows maps.

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
Published player views are not exported, so imported worlds start with sharing
off.

## Share a map with players

Choose **Share with players** in the map toolbar. Nothing is selected at first:
tick the layers, unlayered pins, and unlayered labels/drawings to reveal, plus
individual items on selected layers. Items on an unticked layer are excluded even
if ticked individually. **Preview as player** shows the candidate selection with
the player viewer.

- Players see the published snapshot at the campaign map page, linked from the
  campaign home, until you publish again. Later edits, new pins, hidden layers,
  and renames stay private.
- **Publish to players** stores the selection and increments the revision;
  **Stop sharing** removes it.
- Publishing needs the map image (and any included layer images) to be a
  WorldForge library image shared with all campaign players. The default
  **Also share this map's images** option grants that; declining fails with a
  message. Remote image URLs cannot be published because their bytes cannot be
  gated.
- Use the **Share** panel in the same dialog to choose which campaign players may
  open the map at all. Revoking a player's access hides the map immediately.
- Pin article links appear only when that player can read the linked article, and
  revoking image access replaces the map with an unavailable notice.

**Source owner:** `wiki/Interactive-Maps.md`; implementation:
`docs/interactive-maps.md`, `src/components/map/InteractiveMap.tsx`,
`src/components/map/MapViewer.tsx`, and map APIs.
**Verified against:** `main` (`map publication revision`), source/contract audit
plus the snapshot, viewer, API, and production reader checks; see
[verification record](Wiki-Verification).

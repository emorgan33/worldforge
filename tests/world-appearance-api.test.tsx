import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { authorFetch, assertIsolatedTestEnvironment } from "./auth-fixture";
import { DEFAULT_APPEARANCE } from "../src/lib/world-appearance";
import { removeAssetFile } from "../src/lib/asset-storage";
const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();
test("world appearance validates ownership, persists across ordinary edits and grants/revokes background assets", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const owner = await db.user.create({ data: { name: "Appearance fixture", email: `appearance-${Date.now()}@example.invalid` } });
  context.after(async () => { const assets = await db.imageAsset.findMany({ where: { world: { ownerId: owner.id } } }); for (const asset of assets) await removeAssetFile(asset.id); await db.user.delete({ where: { id: owner.id } }); await db.$disconnect(); });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "The Verdant Coast", slug: `appearance-${owner.id}` } });
  const other = await db.world.create({ data: { ownerId: owner.id, title: "Other world", slug: `other-${owner.id}` } });
  const owned = await authorFetch(db, owner.id, origin!);
  async function upload(worldId: string, color: string) { const form = new FormData(); form.set("worldId", worldId); form.set("file", new Blob([new Uint8Array(await sharp({ create: { width: 4, height: 3, channels: 3, background: color } }).png().toBuffer())], { type: "image/png" }), "background.png"); const response = await owned(`${origin}/api/assets`, { method: "POST", body: form }); assert.equal(response.status, 201); return response.json(); }
  const image = await upload(world.id, "green"); const foreign = await upload(other.id, "blue");
  const patch = (extra: object) => owned(`${origin}/api/worlds`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: world.id, title: world.title, description: "", coverImage: "", bannerImage: "", ...extra }) });
  for (const appearance of [{ ...DEFAULT_APPEARANCE, backgroundImage: foreign.url }, { ...DEFAULT_APPEARANCE, accentColor: "var(--secret)" }, { ...DEFAULT_APPEARANCE, theme: "unknown" }]) assert.equal((await patch({ appearance })).status, 400);
  const appearance = { ...DEFAULT_APPEARANCE, theme: "parchment", readingWidth: "narrow", backgroundImage: image.url, accentColor: "#eeeeee" };
  assert.equal((await patch({ appearance })).status, 200);
  assert.equal((await fetch(`${origin}${image.url}`)).status, 404);
  // Callers changing other world settings must not reset presentation settings.
  assert.equal((await patch({ isPublic: true })).status, 200);
  assert.deepEqual(JSON.parse((await db.world.findUniqueOrThrow({ where: { id: world.id } })).appearance!), appearance);
  assert.equal((await db.world.findUniqueOrThrow({ where: { id: other.id } })).appearance, null);
  assert.equal((await fetch(`${origin}${image.url}`)).status, 200);
  const html = await (await fetch(`${origin}/w/${world.slug}`)).text(); assert(html.includes('data-world-theme="parchment"')); assert(html.includes(image.url));
  assert.equal((await patch({ appearance: DEFAULT_APPEARANCE })).status, 200);
  assert.equal((await fetch(`${origin}${image.url}`)).status, 404);
  await patch({ appearance, isPublic: true }); await patch({ isPublic: false });
  assert.equal((await fetch(`${origin}${image.url}`)).status, 404);
});

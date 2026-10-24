import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { authorFetch, assertIsolatedTestEnvironment } from "./auth-fixture";
import { removeAssetFile } from "../src/lib/asset-storage";
const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
test("owner sessions and public readers enforce drafts, private worlds, GM blocks, related links and image grants", { skip: !origin }, async context => {
  const db = new PrismaClient(); const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "Publishing fixture", email: `publisher-${stamp}@example.invalid` } });
  const outsider = await db.user.create({ data: { name: "Other author", email: `outsider-${stamp}@example.invalid` } });
  context.after(async () => { const assets = await db.imageAsset.findMany({ where: { world: { ownerId: owner.id } } }); for (const asset of assets) await removeAssetFile(asset.id); await db.user.deleteMany({ where: { id: { in: [owner.id, outsider.id] } } }); await db.$disconnect(); });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Reader fixture", slug: `reader-${stamp}`, isPublic: true } });
  const privateArticle = await db.article.create({ data: { worldId: world.id, slug: "private", title: "HIDDEN_TITLE_SENTINEL", publicationStatus: "PUBLISHED", visibility: "PRIVATE", contentHtml: "HIDDEN_PRIVATE_BODY" } });
  const draft = await db.article.create({ data: { worldId: world.id, slug: "draft", title: "HIDDEN_DRAFT_SENTINEL", publicationStatus: "DRAFT", visibility: "PUBLIC", contentHtml: "HIDDEN_DRAFT_BODY" } });
  const target = await db.article.create({ data: { worldId: world.id, slug: "target", title: "Visible destination", publicationStatus: "PUBLISHED", visibility: "PUBLIC" } });
  const owned = await authorFetch(db, owner.id, origin!); const foreign = await authorFetch(db, outsider.id, origin!);
  const block = await db.rpgBlock.create({ data: { worldId: world.id, name: "Private block", system: "DND_5E", category: "MONSTER", statsJson: "{}" } });
  const publicBlock = await db.rpgBlock.create({ data: { worldId: world.id, name: "Published embedded block", system: "DND_5E", category: "MONSTER", statsJson: "{}" } });
  const collection = await db.variableCollection.create({ data: { worldId: world.id, name: "Private variables", prefix: "lore" } });
  const variable = await db.variable.create({ data: { collectionId: collection.id, key: "secret", value: "Private value" } });
  const map = await db.map.create({ data: { worldId: world.id, title: "Private map", imageUrl: "https://example.invalid/map.png" } });

  const imageForm = new FormData(); imageForm.set("worldId", world.id); imageForm.set("file", new Blob([new Uint8Array(await sharp({ create: { width: 3, height: 2, channels: 4, background: "blue" } }).png().toBuffer())], { type: "image/png" }), "private.png");
  const upload = await owned(`${origin}/api/assets`, { method: "POST", body: imageForm }); assert.equal(upload.status, 201); const image = await upload.json();
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Public travel notes. " }, { type: "articleLink", attrs: { articleId: privateArticle.id, label: privateArticle.title } }, { type: "articleLink", attrs: { articleId: target.id, label: target.title } }] }, { type: "campaignStatblock", attrs: { blockId: publicBlock.id } }, { type: "campaignCallout", attrs: { kind: "gmNote" }, content: [{ type: "paragraph", content: [{ type: "text", text: "HIDDEN_GM_SENTINEL" }] }, { type: "image", attrs: { src: image.url } }] }] };
  const created = await owned(`${origin}/api/articles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worldId: world.id, template: "ENCOUNTER", title: "Public guide", publicationStatus: "PUBLISHED", visibility: "PUBLIC", contentJson: doc, contentHtml: "HIDDEN_STALE_HTML", metadata: { linkedLocation: privateArticle.id, linkedPlot: target.id, linkedEncounters: `${target.id}\n${privateArticle.id}`, dnd5eParticipant1: block.id, dnd5eParticipant2: publicBlock.id, extension: "AUTHOR_EXTENSION_SENTINEL" } }) }); assert.equal(created.status, 201); const source = await created.json();
  await db.secret.create({ data: { worldId: world.id, articleId: source.id, title: "HIDDEN_SECRET_TITLE", content: "HIDDEN_SECRET_CONTENT", isRevealed: true } });
  for (const path of ["worlds", `articles?worldId=${world.id}`, `articles/${source.id}`, `categories?worldId=${world.id}`, `maps?worldId=${world.id}`, `timelines?worldId=${world.id}`, `variables?worldId=${world.id}`, `secrets?worldId=${world.id}`, `statblocks?worldId=${world.id}`, `assets?worldId=${world.id}`, `search?worldId=${world.id}`]) assert.equal((await fetch(`${origin}/api/${path}`)).status, 401, path);
  assert.equal((await foreign(`${origin}/api/articles/${source.id}`)).status, 404); assert.equal((await foreign(`${origin}/api/articles?worldId=${world.id}`)).status, 404);
  assert.equal((await foreign(`${origin}/api/articles/${source.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: '{"title":"Takeover"}' })).status, 404);
  for (const path of [`categories?worldId=${world.id}`, `maps?worldId=${world.id}`, `timelines?worldId=${world.id}`, `variables?worldId=${world.id}`, `secrets?worldId=${world.id}`, `statblocks?worldId=${world.id}`, `assets?worldId=${world.id}`, `statblocks/${block.id}`, `search?worldId=${world.id}`]) assert.equal((await foreign(`${origin}/api/${path}`)).status, 404, path);
  const mutate = (path: string, method: string, body: object) => foreign(`${origin}/api/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  for (const [path, method, body] of [
    ["worlds", "PATCH", { id: world.id }], ["categories", "POST", { worldId: world.id, name: "Takeover" }],
    ["variables", "POST", { collectionId: collection.id, key: "takeover", value: "bad" }], ["variables", "PATCH", { id: variable.id, value: "bad" }],
    ["maps", "POST", { mapId: map.id, title: "Takeover", x: 1, y: 1 }], ["secrets", "POST", { worldId: world.id, title: "Takeover", content: "bad" }],
    [`statblocks/${block.id}`, "PATCH", { name: "Takeover" }], [`statblocks/${block.id}`, "DELETE", {}], ["assets", "PATCH", { worldId: world.id, id: image.id, archived: true }],
  ] as const) assert.equal((await mutate(path, method, body)).status, 404, path);
  const foreignWorlds = await (await foreign(`${origin}/api/worlds`)).json(); assert.equal(foreignWorlds.length, 0);
  const cookie = (await owned(`${origin}/api/worlds`)).status; assert.equal(cookie, 200);
  const publicBody = await (await fetch(`${origin}/w/${world.slug}/a/${source.slug}`)).text();
  assert(publicBody.includes("Public travel notes.")); assert(publicBody.includes("Visible destination"));
  for (const hidden of [privateArticle.id, privateArticle.title, draft.title, block.id, "HIDDEN_GM_SENTINEL", "HIDDEN_STALE_HTML", "HIDDEN_SECRET_TITLE", "HIDDEN_SECRET_CONTENT", image.id]) assert(!publicBody.includes(hidden), hidden);
  assert(publicBody.includes(target.id)); assert(publicBody.includes(publicBlock.id)); assert(!publicBody.includes("AUTHOR_EXTENSION_SENTINEL"));
  const worldBody = await (await fetch(`${origin}/w/${world.slug}`)).text(); assert(worldBody.includes(source.title)); assert(!worldBody.includes(privateArticle.title)); assert(!worldBody.includes(draft.title));
  for (const article of [privateArticle, draft]) { const body = await (await fetch(`${origin}/w/${world.slug}/a/${article.slug}`)).text(); assert(!body.includes(article.title)); assert(!body.includes("HIDDEN_PRIVATE_BODY")); assert(!body.includes("HIDDEN_DRAFT_BODY")); }
  assert.equal((await fetch(`${origin}${image.url}`)).status, 404); assert.equal((await owned(`${origin}${image.url}`)).status, 200);
  const publicImageDoc = { type: "doc", content: [{ type: "image", attrs: { src: image.url, alt: "Shared image" } }] };
  const change = (data: object) => owned(`${origin}/api/articles/${source.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  assert.equal((await change({ contentJson: publicImageDoc })).status, 200); assert.equal((await fetch(`${origin}${image.url}`)).status, 200);
  assert.equal((await change({ visibility: "PRIVATE" })).status, 200); assert.equal((await fetch(`${origin}${image.url}`)).status, 404);
  await change({ visibility: "PUBLIC" }); await db.world.update({ where: { id: world.id }, data: { isPublic: false } }); assert.equal((await fetch(`${origin}${image.url}`)).status, 404);
  const closed = await (await fetch(`${origin}/w/${world.slug}`)).text(); assert(!closed.includes(world.title));
});

test("one-time account setup, local sign-in, CSRF checks, expiration and logout revocation", { skip: !origin }, async context => {
  const db = new PrismaClient(); const stamp = Date.now(); const email = `auth-${stamp}@example.invalid`;
  const user = await db.user.create({ data: { name: "Auth fixture", email } });
  context.after(async () => { await db.user.delete({ where: { id: user.id } }); await db.$disconnect(); });
  const token = randomBytes(32).toString("base64url");
  await db.accountSetup.create({ data: { tokenHash: digest(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
  const password = "Fixture passphrase for publishing 901!";
  const setup = () => fetch(`${origin}/api/auth/setup`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin! }, body: JSON.stringify({ token, email, password }) });
  const response = await setup(); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")!.split(";")[0]; assert.match(response.headers.get("set-cookie")!, /HttpOnly/i); assert.match(response.headers.get("set-cookie")!, /SameSite=Lax/i); assert.equal((await setup()).status, 400);
  const loggedIn = () => fetch(`${origin}/api/auth/session`, { headers: { Cookie: cookie } }); assert.equal((await (await loggedIn()).json()).user.id, user.id);
  assert.equal((await fetch(`${origin}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie, Origin: "https://foreign.invalid" } })).status, 403);
  assert.equal((await fetch(`${origin}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie } })).status, 403);
  assert.equal((await fetch(`${origin}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie, Origin: origin! } })).status, 200); assert.equal((await (await loggedIn()).json()).user, null);
  const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin! }, body: JSON.stringify({ email, password }) }); assert.equal(login.status, 200);
  const loginCookie = login.headers.get("set-cookie")!.split(";")[0]; await db.authSession.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(0) } }); assert.equal((await fetch(`${origin}/api/worlds`, { headers: { Cookie: loginCookie } })).status, 401);
  const bad = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin! }, body: JSON.stringify({ email, password: "Incorrect fixture passphrase" }) }); assert.equal(bad.status, 401);
});

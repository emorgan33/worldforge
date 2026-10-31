import assert from "node:assert/strict";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { authorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";
import { removeAssetFile } from "../src/lib/asset-storage";
import { tokenHash } from "../src/lib/passwords";
import { hashPassword } from "../src/lib/passwords";
import { setAccountStatus } from "../src/lib/admin-accounts";
const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
test("owner sessions and public readers enforce drafts, private worlds, GM blocks, related links and image grants", { skip: !origin }, async context => {
  const db = new PrismaClient(); const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "Publishing fixture", email: `publisher-${stamp}@example.invalid` } });
  const outsider = await db.user.create({ data: { name: "Other author", email: `outsider-${stamp}@example.invalid` } });
  context.after(async () => { const assets = await db.imageAsset.findMany({ where: { world: { ownerId: owner.id } } }); for (const asset of assets) await removeAssetFile(asset.id); await deleteTestUsers(db, owner.id, outsider.id); await db.$disconnect(); });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Reader fixture", slug: `reader-${stamp}`, isPublic: true } });
  const parentCategory = await db.category.create({ data: { worldId: world.id, name: "Visible ancestor" } });
  const publicCategory = await db.category.create({ data: { worldId: world.id, parentId: parentCategory.id, name: "Visible category" } });
  const hiddenCategory = await db.category.create({ data: { worldId: world.id, name: "HIDDEN_CATEGORY_SENTINEL" } });
  const privateArticle = await db.article.create({ data: { worldId: world.id, categoryId: hiddenCategory.id, slug: "private", title: "HIDDEN_TITLE_SENTINEL", publicationStatus: "PUBLISHED", visibility: "PRIVATE", contentHtml: "HIDDEN_PRIVATE_BODY" } });
  const draft = await db.article.create({ data: { worldId: world.id, categoryId: hiddenCategory.id, slug: "draft", title: "HIDDEN_DRAFT_SENTINEL", publicationStatus: "DRAFT", visibility: "PUBLIC", contentHtml: "HIDDEN_DRAFT_BODY" } });
  const target = await db.article.create({ data: { worldId: world.id, categoryId: publicCategory.id, slug: "target", title: "Visible destination", publicationStatus: "PUBLISHED", visibility: "PUBLIC" } });
  const owned = await authorFetch(db, owner.id, origin!); const foreign = await authorFetch(db, outsider.id, origin!);
  const invalidSlug = await owned(`${origin}/api/articles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worldId: world.id, title: "Unsafe slug", slug: "bad/path" }) });
  assert.equal(invalidSlug.status, 400, "new articles cannot create backups with unroutable slugs");
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
  for (const hidden of [privateArticle.id, privateArticle.title, draft.title, hiddenCategory.name, block.id, "HIDDEN_GM_SENTINEL", "HIDDEN_STALE_HTML", "HIDDEN_SECRET_TITLE", "HIDDEN_SECRET_CONTENT", image.id]) assert(!publicBody.includes(hidden), hidden);
  assert(publicBody.includes(parentCategory.name)); assert(publicBody.includes(publicCategory.name));
  assert(publicBody.includes(target.id)); assert(publicBody.includes(publicBlock.id)); assert(!publicBody.includes("AUTHOR_EXTENSION_SENTINEL"));
  const worldBody = await (await fetch(`${origin}/w/${world.slug}`)).text(); assert(worldBody.includes(source.title)); assert(!worldBody.includes(privateArticle.title)); assert(!worldBody.includes(draft.title)); assert(!worldBody.includes(hiddenCategory.name)); assert(worldBody.includes(parentCategory.name));
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
  context.after(async () => { await deleteTestUsers(db, user.id); await db.$disconnect(); });
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
  for (let attempt = 0; attempt < 8; attempt++) {
    const failed = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin!, "X-WorldForge-Client-IP": "192.0.2.10" }, body: JSON.stringify({ email, password: "Incorrect fixture passphrase" }) });
    assert.equal(failed.status, 401);
  }
  const blocked = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin!, "X-WorldForge-Client-IP": "192.0.2.10", "X-Forwarded-For": "203.0.113.9" }, body: JSON.stringify({ email, password }) });
  assert.equal(blocked.status, 429, "spoofing a generic forwarding header does not evade the source limit");
  const legitimate = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin!, "X-WorldForge-Client-IP": "192.0.2.11" }, body: JSON.stringify({ email, password }) });
  assert.equal(legitimate.status, 200, "another source can sign in to the targeted account");
  const repeatSource = "198.51.100.20";
  const repeatHeaders = { "Content-Type": "application/json", Origin: origin!, "X-WorldForge-Client-IP": repeatSource };
  const priorFailure = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: repeatHeaders, body: JSON.stringify({ email, password: "Incorrect fixture passphrase" }) });
  assert.equal(priorFailure.status, 401);
  for (let attempt = 0; attempt < 31; attempt++) {
    const repeated = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: repeatHeaders, body: JSON.stringify({ email, password }) });
    assert.equal(repeated.status, 200, `successful sign-in ${attempt + 1} releases its source reservation`);
  }
  const retainedFailure = await db.loginLimit.findUnique({ where: { key: tokenHash(`login-source:${repeatSource}`) } });
  assert.equal(retainedFailure?.attempts, 1, "success releases one reservation without erasing prior failures");
  const previewWorld = await db.world.create({ data: { ownerId: user.id, title: "Logout preview", slug: `logout-preview-${stamp}` } });
  const previewToken = randomBytes(32).toString("base64url");
  await db.previewSession.create({ data: { tokenHash: digest(previewToken), userId: user.id, worldId: previewWorld.id, expiresAt: new Date(Date.now() + 60_000) } });
  const logout = await fetch(`${origin}/api/auth/logout`, { method: "POST", headers: { Cookie: `${loginCookie}; wf_preview=${previewToken}`, Origin: origin! } });
  assert.equal(logout.status, 200, "logout succeeds even with an expired normal session");
  assert.ok((await db.previewSession.findUniqueOrThrow({ where: { tokenHash: digest(previewToken) } })).revokedAt);
  assert.match(logout.headers.get("set-cookie") || "", /wf_preview=/);
});

test("disabled accounts cannot use existing sessions, login, or setup; setup is email-bound and replaces credentials atomically", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const stamp = randomUUID();
  const password = "Disabled-account fixture passphrase 902!";
  const disabled = await db.user.create({ data: { name: "Disabled auth fixture", email: `disabled-${stamp}@example.invalid`, passwordHash: await hashPassword(password), disabledAt: new Date() } });
  const disabledSetupToken = randomBytes(32).toString("base64url");
  const active = await db.user.create({ data: { name: "Setup-bound fixture", email: `setup-bound-${stamp}@example.invalid` } });
  const setupToken = randomBytes(32).toString("base64url");
  const priorSessionToken = randomBytes(32).toString("base64url");
  await db.accountSetup.createMany({ data: [
    { userId: disabled.id, tokenHash: digest(disabledSetupToken), expiresAt: new Date(Date.now() + 60_000) },
    { userId: active.id, tokenHash: digest(setupToken), expiresAt: new Date(Date.now() + 60_000) },
  ] });
  const priorSession = await db.authSession.create({ data: { userId: active.id, tokenHash: digest(priorSessionToken), expiresAt: new Date(Date.now() + 60_000) } });
  context.after(async () => { await deleteTestUsers(db, disabled.id, active.id); await db.$disconnect(); });

  const cookie = `worldforge_session=${priorSessionToken}`;
  assert.equal((await fetch(`${origin}/api/auth/session`, { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await (await fetch(`${origin}/api/auth/session`, { headers: { Cookie: cookie } })).json()).user.id, active.id);
  const changedEmail = `changed-${stamp}@example.invalid`;
  const setup = (token: string, email: string) => fetch(`${origin}/api/auth/setup`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin! },
    body: JSON.stringify({ token, email, password }),
  });
  assert.equal((await setup(setupToken, changedEmail)).status, 400);
  assert.equal((await db.accountSetup.findUniqueOrThrow({ where: { tokenHash: digest(setupToken) } })).usedAt, null);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: active.id } })).email, active.email);

  const disabledSessionToken = randomBytes(32).toString("base64url");
  await db.authSession.create({ data: { userId: disabled.id, tokenHash: digest(disabledSessionToken), expiresAt: new Date(Date.now() + 60_000) } });
  const sessionResponse = await fetch(`${origin}/api/auth/session`, { headers: { Cookie: `worldforge_session=${disabledSessionToken}` } });
  assert.equal((await sessionResponse.json()).user, null);
  const sessionsBeforeLogin = await db.authSession.count({ where: { userId: disabled.id } });
  const disabledLogin = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin! }, body: JSON.stringify({ email: disabled.email, password }) });
  assert.equal(disabledLogin.status, 401);
  assert.equal((await disabledLogin.json()).error, "Email or password is incorrect.");
  assert.equal(await db.authSession.count({ where: { userId: disabled.id } }), sessionsBeforeLogin);
  assert.equal((await setup(disabledSetupToken, disabled.email)).status, 400);
  assert.equal((await db.accountSetup.findUniqueOrThrow({ where: { tokenHash: digest(disabledSetupToken) } })).usedAt, null);

  const success = await setup(setupToken, active.email);
  assert.equal(success.status, 200);
  const setCookie = success.headers.get("set-cookie") || "";
  assert.match(setCookie, /HttpOnly/i);
  assert.equal(await db.authSession.findUnique({ where: { id: priorSession.id } }), null);
  assert.equal(await db.authSession.count({ where: { userId: active.id } }), 1);
  const saved = await db.user.findUniqueOrThrow({ where: { id: active.id } });
  assert.equal(saved.email, active.email);
  assert.ok(saved.lastSignInAt);
  assert.equal((await db.accountSetup.findUniqueOrThrow({ where: { tokenHash: digest(setupToken) } })).usedAt !== null, true);
});

test("login and setup races with disable cannot leave sessions on a disabled account", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const stamp = randomUUID();
  const admin = await db.user.create({ data: { name: "Lifecycle admin", email: `lifecycle-admin-${stamp}@example.invalid`, role: "ADMIN" } });
  const adminToken = randomBytes(32).toString("base64url");
  const adminSession = await db.authSession.create({ data: { userId: admin.id, tokenHash: digest(adminToken), expiresAt: new Date(Date.now() + 60_000) } });
  const actor = { type: "WEB_ADMIN" as const, userId: admin.id, sessionId: adminSession.id };
  const password = "Lifecycle race fixture passphrase 903!";
  const loginTarget = await db.user.create({ data: { name: "Login race", email: `login-race-${stamp}@example.invalid`, passwordHash: await hashPassword(password) } });
  const setupTarget = await db.user.create({ data: { name: "Setup race", email: `setup-race-${stamp}@example.invalid` } });
  const setupToken = randomBytes(32).toString("base64url");
  await db.accountSetup.create({ data: { userId: setupTarget.id, tokenHash: digest(setupToken), expiresAt: new Date(Date.now() + 60_000) } });
  context.after(async () => { await deleteTestUsers(db, admin.id, loginTarget.id, setupTarget.id); await db.$disconnect(); });

  const loginRequest = fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin!, "X-WorldForge-Client-IP": `192.0.2.${Math.floor(Math.random() * 200) + 1}` }, body: JSON.stringify({ email: loginTarget.email, password }) });
  const loginDisable = setAccountStatus(db, actor, { userId: loginTarget.id, expectedVersion: 0 }, { disabled: true });
  const [loginResponse, loginMutation] = await Promise.all([loginRequest, loginDisable]);
  const finalLoginTarget = await db.user.findUniqueOrThrow({ where: { id: loginTarget.id } });
  const loginSessions = await db.authSession.count({ where: { userId: loginTarget.id } });
  if (loginMutation.ok) {
    assert.ok(finalLoginTarget.disabledAt);
    assert.equal(loginSessions, 0);
  } else {
    assert.equal(loginMutation.error.code, "CONCURRENCY_CONFLICT");
    assert.equal(finalLoginTarget.disabledAt, null);
  }
  assert.ok(loginResponse.status === 200 || loginResponse.status === 401);

  const setupRequest = fetch(`${origin}/api/auth/setup`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin! }, body: JSON.stringify({ token: setupToken, email: setupTarget.email, password }) });
  const setupDisable = setAccountStatus(db, actor, { userId: setupTarget.id, expectedVersion: 0 }, { disabled: true });
  const [setupResponse, setupMutation] = await Promise.all([setupRequest, setupDisable]);
  const finalSetupTarget = await db.user.findUniqueOrThrow({ where: { id: setupTarget.id } });
  const setupSessions = await db.authSession.count({ where: { userId: setupTarget.id } });
  assert.equal(finalSetupTarget.disabledAt !== null && setupSessions > 0, false, "disable and setup serialize so disabled accounts never retain a session");
  if (finalSetupTarget.disabledAt) assert.equal(setupResponse.status, 400);
  if (setupResponse.status === 200) assert.equal(finalSetupTarget.disabledAt, null, "setup winning the lock makes the stale disable fail rather than leave a disabled live session");
  if (setupMutation.ok) assert.ok(finalSetupTarget.disabledAt);
  else assert.ok(["STALE_ACCOUNT", "CONCURRENCY_CONFLICT"].includes(setupMutation.error.code));
});

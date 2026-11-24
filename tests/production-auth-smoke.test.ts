import assert from "node:assert/strict";
import { testPrismaClient } from "./test-prisma-client";
import { test } from "node:test";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";
import { hashPassword } from "../src/lib/passwords";
import { SESSION_COOKIE } from "../src/lib/auth-constants";

const origin = process.env.WORLDFORGE_PRODUCTION_TEST_ORIGIN;

test("production login issues a session accepted by authenticated APIs", { skip: !origin }, async context => {
  if (!origin) return;
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  const email = `production-auth-${randomUUID()}@example.invalid`;
  const password = "Isolated production smoke passphrase 2046!";
  const user = await db.user.create({
    data: { name: "Production auth smoke", email, passwordHash: await hashPassword(password) },
  });
  const fixtureUserIds = [user.id];
  context.after(async () => {
    for (const userId of fixtureUserIds) await deleteTestUsers(db, userId);
    await db.$disconnect();
  });

  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "X-WorldForge-Client-IP": "127.0.0.1" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200, await login.text());
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith(`${SESSION_COOKIE}=`), "login must set the session cookie");
  const cookieHeader = cookie!;

  const themeChange = await fetch(`${origin}/api/preferences/theme`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookieHeader },
    body: JSON.stringify({ theme: "daylight" }),
  });
  assert.equal(themeChange.status, 200, await themeChange.text());
  assert.match(themeChange.headers.get("set-cookie") ?? "", /wf_theme=daylight/);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { theme: true } })).theme, "daylight");

  const session = await fetch(`${origin}/api/auth/session`, { headers: { Cookie: cookieHeader } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).user.id, user.id);

  const worlds = await fetch(`${origin}/api/worlds`, { headers: { Cookie: cookieHeader } });
  assert.equal(worlds.status, 200, "the production server must accept its issued session on an authenticated API");

  // Pages use streamed Next redirects, which can have HTTP 200 while the
  // browser navigates to the destination. Assert the user-visible result.
  const browser = await chromium.launch({ headless: true });
  context.after(async () => browser.close());
  const workspace = await browser.newPage();
  await workspace.context().addCookies([{ name: SESSION_COOKIE, value: cookie.split("=")[1], url: origin, httpOnly: true, sameSite: "Lax" }]);
  await workspace.goto(`${origin}/`);
  await workspace.waitForSelector(".author-workspace", { timeout: 20000 });
  const shellColor = await workspace.evaluate(() => {
    const shell = document.querySelector(".author-workspace");
    return shell ? getComputedStyle(shell).backgroundColor : null;
  });
  assert.equal(shellColor, "rgb(246, 245, 243)", "Daylight must reach the workspace shell, not only the login page");
  const sidebar = await workspace.evaluate(() => {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const context = probe.getContext("2d");
    const aside = document.querySelector("aside");
    const accent = Array.from(document.querySelectorAll("button")).find(button => button.textContent?.trim() === "New article");
    const navLabel = Array.from(aside?.querySelectorAll("nav button span") ?? []).find(span => span.textContent === "Articles");
    const search = aside?.querySelector('button[aria-label="Search this world"]');
    const entries: Array<[string, Element | null | undefined, "backgroundColor" | "color" | "borderTopColor"]> = [
      ["background", aside, "backgroundColor"],
      ["accent", accent, "backgroundColor"],
      ["accentText", accent, "color"],
      ["navLabel", navLabel, "color"],
      ["searchBorder", search, "borderTopColor"],
    ];
    const result: Record<string, string | null> = {};
    for (const [key, element, property] of entries) {
      if (!element || !context) { result[key] = null; continue; }
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "#000000";
      context.fillStyle = getComputedStyle(element)[property];
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      result[key] = `rgb(${r}, ${g}, ${b})`;
    }
    return result;
  });
  assert.equal(sidebar.background, "rgb(255, 255, 255)", "Daylight sidebar must not stay on the Night watch panel color");
  assert.equal(sidebar.accent, "rgb(112, 8, 231)", "Daylight sidebar action must use the dark-violet accent");
  assert.equal(sidebar.accentText, "rgb(255, 255, 255)", "Daylight sidebar action label must be white");
  assert.equal(sidebar.navLabel, "rgb(92, 89, 82)", "Daylight sidebar labels must use the light-palette muted ink");
  assert.equal(sidebar.searchBorder, "rgb(138, 135, 129)", "Daylight sidebar controls must use the strong outline, not the decorative divider");
  await workspace.close();

  const anonPage = await browser.newPage();
  await anonPage.goto(`${origin}/admin/users`);
  await anonPage.waitForURL(/\/login(?:\?|$)/);
  assert.match(await anonPage.locator("body").innerText(), /sign in|log in|email/i);

  const anonApiResponse = await fetch(`${origin}/api/admin/users`, { redirect: "manual" });
  assert.equal(anonApiResponse.status, 401, `anonymous /api/admin/users must return 401 (status ${anonApiResponse.status})`);

  // Non-admin (AUTHOR) session denied at /admin/users
  const nonAdminUser = await db.user.create({ data: { name: "Production non-admin", email: `production-nonadmin-${randomUUID()}@example.invalid`, role: "AUTHOR" } });
  fixtureUserIds.push(nonAdminUser.id);
  const nonAdminToken = randomBytes(32).toString("base64url");
  await db.authSession.create({ data: { userId: nonAdminUser.id, tokenHash: createHash("sha256").update(nonAdminToken).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
  const nonAdminCookieHeader = `${SESSION_COOKIE}=${nonAdminToken}`;
  const nonAdminPage = await browser.newPage();
  await nonAdminPage.context().addCookies([{ name: SESSION_COOKIE, value: nonAdminToken, url: origin }]);
  await nonAdminPage.goto(`${origin}/admin/users`);
  await nonAdminPage.getByRole("heading", { name: "Administrator access required" }).waitFor();
  assert.match(await nonAdminPage.locator("body").innerText(), /does not have installation administration rights/i);
  assert.doesNotMatch(await nonAdminPage.locator("body").innerText(), /Running build/, "build metadata is only shown to administrators");
  const nonAdminApiResponse = await fetch(`${origin}/api/admin/users`, { headers: { Cookie: nonAdminCookieHeader } });
  assert.equal(nonAdminApiResponse.status, 403, `non-admin /api/admin/users must return 403 (status ${nonAdminApiResponse.status})`);

  // Disabled admin denied
  const disabledAdminAccount = await db.user.create({
    data: { name: "Production disabled admin", email: `production-disabled-admin-${randomUUID()}@example.invalid`, role: "ADMIN", disabledAt: new Date() },
  });
  fixtureUserIds.push(disabledAdminAccount.id);
  const disabledAdminToken = randomBytes(32).toString("base64url");
  await db.authSession.create({
    data: { userId: disabledAdminAccount.id, tokenHash: createHash("sha256").update(disabledAdminToken).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const disabledAdminCookieHeader = `${SESSION_COOKIE}=${disabledAdminToken}`;
  const disabledAdminPage = await browser.newPage();
  await disabledAdminPage.context().addCookies([{ name: SESSION_COOKIE, value: disabledAdminToken, url: origin }]);
  await disabledAdminPage.goto(`${origin}/admin/users`);
  await disabledAdminPage.waitForURL(/\/login(?:\?|$)/);
  assert.match(await disabledAdminPage.locator("body").innerText(), /sign in|log in|email/i);

  const disabledAdminApiResponse = await fetch(`${origin}/api/admin/users`, { headers: { Cookie: disabledAdminCookieHeader, Origin: origin } });
  assert.equal(disabledAdminApiResponse.status, 401, `disabled admin /api/admin/users must return 401 (status ${disabledAdminApiResponse.status})`);
  // Active admin accepted at /admin/users and /api/admin/users
  const activeAdminAccount = await db.user.create({
    data: { name: "Production active admin", email: `production-active-admin-${randomUUID()}@example.invalid`, role: "ADMIN", disabledAt: null },
  });
  fixtureUserIds.push(activeAdminAccount.id);
  const activeAdminToken = randomBytes(32).toString("base64url");
  await db.authSession.create({
    data: { userId: activeAdminAccount.id, tokenHash: createHash("sha256").update(activeAdminToken).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const activeAdminCookieHeader = `${SESSION_COOKIE}=${activeAdminToken}`;
  const activeAdminPage = await browser.newPage();
  await activeAdminPage.context().addCookies([{ name: SESSION_COOKIE, value: activeAdminToken, url: origin }, { name: "wf_theme", value: "daylight", url: origin }]);
  await activeAdminPage.goto(`${origin}/admin/users`);
  await activeAdminPage.getByRole("heading", { name: "Installation administration" }).waitFor();
  await activeAdminPage.getByRole("heading", { name: "Accounts" }).waitFor();
  const runningBuild = await activeAdminPage.getByTestId("running-build").innerText();
  assert.match(runningBuild, /Running build v\d+\.\d+\.\d+ · [0-9a-f]{7,40}/, "the admin header must identify the build serving the page");
  const accountsHeading = await activeAdminPage.getByRole("heading", { name: "Accounts" }).evaluate(el => {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const context = probe.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#000000";
    context.fillStyle = getComputedStyle(el).color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  });
  assert.equal(accountsHeading, "rgb(151, 60, 0)", "Daylight admin headings must use the dark amber foreground, not the pale dark-theme shade");

  const activeAdminApiResponse = await fetch(`${origin}/api/admin/users`, { headers: { Cookie: activeAdminCookieHeader, Origin: origin } });
  assert.equal(activeAdminApiResponse.status, 200, `active admin /api/admin/users must return 200 (status ${activeAdminApiResponse.status})`);
});

test("reader pages render instead of the prerender error page", { skip: !origin }, async context => {
  if (!origin) return;
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  const stamp = randomUUID();
  const owner = await db.user.create({ data: { name: "Reader smoke owner", email: `reader-owner-${stamp}@example.invalid`, role: "GM" } });
  const player = await db.user.create({ data: { name: "Reader smoke player", email: `reader-player-${stamp}@example.invalid`, role: "PLAYER" } });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Reader smoke world", slug: `reader-smoke-${stamp}`, isPublic: true } });
  const article = await db.article.create({
    data: {
      worldId: world.id,
      slug: `reader-smoke-article-${stamp}`,
      title: "Reader smoke article",
      publicationStatus: "PUBLISHED",
      visibility: "PUBLIC",
      contentHtml: "<p>Reader smoke body</p>",
    },
  });
  await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "articles", resourceId: article.id, mode: "PUBLIC", createdById: owner.id } });
  await db.worldMember.create({ data: { worldId: world.id, userId: player.id, role: "PLAYER", status: "ACTIVE" } });
  const token = randomBytes(32).toString("base64url");
  await db.authSession.create({
    data: { userId: player.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  context.after(async () => {
    await db.article.deleteMany({ where: { worldId: world.id } });
    await db.audiencePolicy.deleteMany({ where: { worldId: world.id } });
    await db.worldMember.deleteMany({ where: { worldId: world.id } });
    await db.world.deleteMany({ where: { id: world.id } });
    for (const userId of [player.id, owner.id]) await deleteTestUsers(db, userId);
    await db.$disconnect();
  });

  const ownerToken = randomBytes(32).toString("base64url");
  await db.authSession.create({
    data: { userId: owner.id, tokenHash: createHash("sha256").update(ownerToken).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
  });

  const headers = { Cookie: `${SESSION_COOKIE}=${token}` };
  for (const [path, heading] of [
    [`/c/${world.slug}`, "Reader smoke world"],
    [`/c/${world.slug}/a/${article.slug}`, "Reader smoke article"],
    [`/w/${world.slug}`, "Reader smoke world"],
    [`/w/${world.slug}/a/${article.slug}`, "Reader smoke article"],
  ] as const) {
    const response = await fetch(`${origin}${path}`, { headers });
    const html = await response.text();
    assert.equal(response.status, 200, `${path} returned ${response.status}`);
    assert.doesNotMatch(html, /__next_error__/, `${path} rendered Next's prerender error page`);
    assert.match(html, new RegExp(heading), `${path} must render ${heading}`);
  }

  // Authenticated surfaces that also query the database must not fall back to
  // the prerender error page either.
  for (const path of ["/", "/player"]) {
    const response = await fetch(`${origin}${path}`, { headers: { Cookie: `${SESSION_COOKIE}=${ownerToken}` }, redirect: "manual" });
    const html = await response.text();
    assert.equal(response.status, 200, `${path} returned ${response.status}`);
    assert.doesNotMatch(html, /__next_error__/, `${path} rendered Next's prerender error page`);
    assert.match(html, /<title>WorldForge/, `${path} must render the application shell`);
  }

  for (const path of [`/w/${world.slug}`, `/w/${world.slug}/a/${article.slug}`]) {
    const response = await fetch(`${origin}${path}`);
    const html = await response.text();
    assert.equal(response.status, 200, `${path} returned ${response.status} anonymously`);
    assert.doesNotMatch(html, /__next_error__/, `${path} rendered Next's prerender error page anonymously`);
    assert.match(html, /Reader smoke (?:world|article)/, `${path} must render its content anonymously`);
  }

  for (const theme of ["night-watch", "daylight"]) {
    const response = await fetch(`${origin}/w/${world.slug}`, { headers: { Cookie: `wf_theme=${theme}` } });
    const html = await response.text();
    assert.equal(response.status, 200, `/w/${world.slug} returned ${response.status} for ${theme}`);
    assert.match(html, new RegExp(`data-theme="${theme}"`), `${theme} must be applied to <html>`);
    assert.match(html, /aria-label="Interface theme"/, `${theme} reader must render the theme control`);
    assert.match(html, /<div class="flex justify-end bg-app-canvas/, `${theme} reader bar must paint its own themed background`);
    assert.match(html, /data-world-theme=/, "world presentation must still carry its own theme marker, not the chrome theme");
  }
});

test("published maps reach players without unpublished content", { skip: !origin }, async context => {
  if (!origin) return;
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  const stamp = randomUUID();
  const owner = await db.user.create({ data: { name: "Map reader owner", email: `map-reader-owner-${stamp}@example.invalid`, role: "GM" } });
  const player = await db.user.create({ data: { name: "Map reader player", email: `map-reader-player-${stamp}@example.invalid`, role: "PLAYER" } });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Map reader world", slug: `map-reader-${stamp}`, isPublic: false } });
  const asset = await db.imageAsset.create({
    data: {
      worldId: world.id, title: "Player map", originalName: "map.webp", byteSize: 64, width: 1200, height: 800,
      sha256: stamp.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
    },
  });
  const map = await db.map.create({
    data: { worldId: world.id, title: "Working map title", imageUrl: `/api/assets/${asset.id}/file`, width: 1200, height: 800 },
  });
  const snapshot = {
    version: 1,
    title: "Map reader world atlas",
    description: "Everything the party has discovered.",
    imageUrl: `/api/assets/${asset.id}/file`,
    width: 1200,
    height: 800,
    defaultZoom: 1,
    layers: [],
    markers: [{ id: "published-pin", layerId: null, title: "Harbor of Dawn", description: "A safe port", x: 30, y: 40, icon: "flag", color: "#3b82f6", articleId: null }],
    elements: [],
  };
  await db.audiencePolicy.createMany({
    data: [
      { worldId: world.id, resourceKind: "maps", resourceId: map.id, mode: "PUBLIC", createdById: owner.id },
      { worldId: world.id, resourceKind: "assets", resourceId: asset.id, mode: "PUBLIC", createdById: owner.id },
    ],
  });
  await db.mapPublication.create({ data: { mapId: map.id, snapshot: JSON.stringify(snapshot), publishedById: owner.id } });
  await db.marker.create({ data: { mapId: map.id, title: "Hidden vault", x: 10, y: 10 } });
  await db.worldMember.create({ data: { worldId: world.id, userId: player.id, role: "PLAYER", status: "ACTIVE" } });
  const token = randomBytes(32).toString("base64url");
  await db.authSession.create({ data: { userId: player.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
  context.after(async () => {
    await db.audiencePolicy.deleteMany({ where: { worldId: world.id } });
    await db.worldMember.deleteMany({ where: { worldId: world.id } });
    await db.world.deleteMany({ where: { id: world.id } });
    for (const userId of [player.id, owner.id]) await deleteTestUsers(db, userId);
    await db.$disconnect();
  });

  const page = await fetch(`${origin}/c/${world.slug}/maps/${map.id}`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
  const html = await page.text();
  assert.equal(page.status, 200, `player map page returned ${page.status}`);
  assert.doesNotMatch(html, /__next_error__/, "the player map page must not render the prerender error page");
  assert.match(html, /Map reader world atlas/, "readers see the published snapshot title, not the working map title");
  assert.match(html, /Harbor of Dawn/, "published pins are rendered");
  assert.doesNotMatch(html, /Working map title/, "the editable map record must not leak");
  assert.doesNotMatch(html, /Hidden vault/, "pins outside the published snapshot must not leak");
  assert.match(html, /aria-label="Map pins"/, "the pin list is keyboard accessible");

  const campaignHome = await fetch(`${origin}/c/${world.slug}`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
  assert.match(await campaignHome.text(), /Map reader world atlas/, "campaign home lists published maps");

  const anonymous = await fetch(`${origin}/c/${world.slug}/maps/${map.id}`, { redirect: "manual" });
  const anonymousHtml = await anonymous.text();
  assert.doesNotMatch(anonymousHtml, /Map reader world atlas/, "anonymous readers must not receive the published map");
});

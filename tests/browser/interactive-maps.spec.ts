import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test as base, type Page, type Route } from "@playwright/test";
import { SESSION_COOKIE } from "../../src/lib/auth-constants";
import { assertIsolatedTestEnvironment } from "../auth-fixture";

const test = base.extend<{ mapEditor: { page: Page; db: PrismaClient; mapId: string } }>({
  mapEditor: async ({ page, context, baseURL }, run) => {
    assertIsolatedTestEnvironment();
    const db = new PrismaClient();
    let ownerId: string | undefined;
    try {
      const owner = await db.user.create({ data: { name: "Map browser fixture", email: `map-browser-${randomUUID()}@example.invalid` } });
      ownerId = owner.id;
      const world = await db.world.create({ data: { ownerId, title: "Map browser world", slug: `map-browser-${randomUUID()}` } });
      const map = await db.map.create({ data: { worldId: world.id, title: "Pointer map", imageUrl: "https://example.invalid/map.png", width: 1000, height: 600 } });
      const token = randomBytes(32).toString("base64url");
      await db.authSession.create({ data: { userId: ownerId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
      await context.addCookies([{ name: SESSION_COOKIE, value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
      await page.route("https://example.invalid/**", route => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("") }));
      await page.goto(`/?world=${world.id}`);
      await page.getByRole("button", { name: "Maps", exact: true }).click();
      await expect(page.getByTestId("map-surface")).toBeVisible();
      await run({ page, db, mapId: map.id });
    } finally {
      await Promise.all(context.pages().map(target => target.close()));
      try { if (ownerId) await db.user.delete({ where: { id: ownerId } }); }
      finally { await db.$disconnect(); }
    }
  },
});

async function draw(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const bounds = await page.getByTestId("map-surface").boundingBox();
  if (!bounds) throw new Error("Map surface is not visible.");
  await page.mouse.move(bounds.x + bounds.width * from.x, bounds.y + bounds.height * from.y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * to.x, bounds.y + bounds.height * to.y, { steps: 4 });
  await page.mouse.up();
}

async function hasInkAlong(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  return page.getByTestId("map-surface").locator("canvas").evaluate((canvas, segment) => {
    const target = canvas as HTMLCanvasElement;
    const context = target.getContext("2d");
    if (!context) return false;
    for (let step = 1; step < 20; step++) {
      const x = Math.floor(target.width * (segment.from.x + (segment.to.x - segment.from.x) * step / 20));
      const y = Math.floor(target.height * (segment.from.y + (segment.to.y - segment.from.y) * step / 20));
      for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) {
        if (x + dx >= 0 && y + dy >= 0 && x + dx < target.width && y + dy < target.height && context.getImageData(x + dx, y + dy, 1, 1).data[3] > 0) return true;
      }
    }
    return false;
  }, { from, to });
}

test("a failed earlier stroke survives a later success, stays guarded, and can be retried", async ({ mapEditor }) => {
  const { page, db, mapId } = mapEditor;
  await page.getByRole("button", { name: "Freehand", exact: true }).click();
  const writes: Route[] = [];
  await page.route("**/api/maps", async route => {
    if (route.request().method() === "POST" && route.request().postDataJSON()?.action === "createElement") {
      writes.push(route);
      if (writes.length <= 2) return;
      await route.continue();
      return;
    }
    await route.continue();
  });

  await draw(page, { x: 0.15, y: 0.25 }, { x: 0.3, y: 0.35 });
  await expect.poll(() => writes.length).toBe(1);
  await draw(page, { x: 0.6, y: 0.65 }, { x: 0.8, y: 0.75 });
  await expect.poll(() => writes.length).toBe(2);

  await writes[0].fulfill({ status: 500, json: { error: "Write failed" } });
  await expect(page.locator("p[role=alert]")).toHaveText("Write failed");
  await writes[1].continue();
  await expect.poll(() => db.mapElement.count({ where: { mapId } })).toBe(1);
  const retainedFirstStroke = await hasInkAlong(page, { x: 0.15, y: 0.25 }, { x: 0.3, y: 0.35 });
  expect(retainedFirstStroke).toBe(true);
  await expect(page.getByText("Drawing save failed")).toBeVisible();
  await expect(page.getByRole("button", { name: "New map", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Choose map" })).toBeDisabled();

  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  let leavePrompt = "";
  page.once("dialog", async dialog => { leavePrompt = dialog.message(); await dialog.dismiss(); });
  await page.getByRole("button", { name: "Home", exact: true }).click();
  expect(leavePrompt).toContain("map editing");
  await expect(page.getByTestId("map-surface")).toBeVisible();

  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => writes.length).toBe(3);
  await expect.poll(() => db.mapElement.count({ where: { mapId } })).toBe(2);
  await expect(page.getByText("Drawing save failed")).toHaveCount(0);
});

test("failed strokes can be discarded explicitly before leaving the map", async ({ mapEditor }) => {
  const { page, db, mapId } = mapEditor;
  await page.getByRole("button", { name: "Freehand", exact: true }).click();
  await page.route("**/api/maps", async route => {
    if (route.request().method() === "POST" && route.request().postDataJSON()?.action === "createElement") {
      return route.fulfill({ status: 500, json: { error: "Write failed" } });
    }
    await route.continue();
  });
  await draw(page, { x: 0.2, y: 0.25 }, { x: 0.35, y: 0.4 });
  await expect(page.getByText("Drawing save failed")).toBeVisible();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByText("Drawing save failed")).toHaveCount(0);
  expect(await db.mapElement.count({ where: { mapId } })).toBe(0);

  let prompted = false;
  page.once("dialog", async dialog => { prompted = true; await dialog.dismiss(); });
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByTestId("map-surface")).toHaveCount(0);
  expect(prompted).toBe(false);
});

test("a single pointer click with the eraser creates a padded erase stroke", async ({ mapEditor }) => {
  const { page, db, mapId } = mapEditor;
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  let writes = 0;
  await page.route("**/api/maps", async route => {
    if (route.request().method() === "POST" && route.request().postDataJSON()?.action === "createElement") writes++;
    await route.continue();
  });
  const bounds = await page.getByTestId("map-surface").boundingBox();
  if (!bounds) throw new Error("Map surface is not visible.");
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.up();

  await expect.poll(() => writes).toBe(1);
  await expect.poll(() => db.mapElement.count({ where: { mapId } })).toBe(1);
  const stroke = await db.mapElement.findFirstOrThrow({ where: { mapId } });
  expect(stroke.kind).toBe("PATH");
  expect(JSON.parse(stroke.style!)).toMatchObject({ erase: true });
  expect(JSON.parse(stroke.geometry).points).toHaveLength(2);
});

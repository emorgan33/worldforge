import { randomBytes, createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { test as base, expect, type Page, type Route } from "@playwright/test";
import { SESSION_COOKIE } from "../../src/lib/auth-constants";
import { assertIsolatedTestEnvironment } from "../auth-fixture";

const hostileValue = '<img src=x onerror="window.injected=true">';
const input = (page: Page, key: string) => page.getByRole("textbox", { name: `Value for [lore:${key}]`, exact: true });
const save = (page: Page, key: string) => input(page, key).locator("..").getByRole("button");
const variablesHeading = (page: Page) => page.getByRole("heading", { name: "Global Variable Collections" });

// The row renders before useWorldGuard's passive effect updates its parent.
async function settleGuard(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function holdWrites(page: Page) {
  const writes: Route[] = [];
  await page.route("**/api/variables", route => {
    if (route.request().method() === "PATCH") writes.push(route);
    else return route.continue();
  });
  return writes;
}

const test = base.extend<{ variables: Page }>({
  variables: async ({ page, context, baseURL }, run) => {
    assertIsolatedTestEnvironment();
    const db = new PrismaClient();
    let ownerId: string | undefined;
    try {
      const owner = await db.user.create({ data: { name: "Variable browser fixture", email: `variables-browser-${randomUUID()}@example.invalid` } });
      ownerId = owner.id;
      const world = await db.world.create({ data: { ownerId, title: "Variable browser world", slug: `variables-browser-${randomUUID()}` } });
      await db.variableCollection.create({ data: {
        worldId: world.id, name: "Browser lore", prefix: "lore",
        variables: { create: [
          { key: "world_name", type: "TERM_SIMPLE", value: hostileValue },
          { key: "year", type: "NUMBER", value: "100" },
          { key: "fragment", type: "RENDERED_FRAGMENT", value: `<strong>Bold</strong>${hostileValue}<a href="javascript:window.injected=true">Link</a>` },
        ] },
      } });
      const token = randomBytes(32).toString("base64url");
      await db.authSession.create({ data: { userId: ownerId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
      await context.addCookies([{ name: SESSION_COOKIE, value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
      await page.goto(`/?world=${world.id}`);
      await page.getByRole("button", { name: "Variables", exact: true }).click();
      await expect(variablesHeading(page)).toBeVisible();
      await run(page);
    } finally {
      await page.close();
      try {
        if (ownerId) {
          await db.world.deleteMany({ where: { ownerId } });
          await db.user.delete({ where: { id: ownerId } });
        }
      } finally { await db.$disconnect(); }
    }
  },
});

for (const failure of [400, 401, 403, 500, "network"] as const) {
  test(`a ${failure} save failure preserves the edit, shows an error and allows retry`, async ({ variables: page }) => {
    const writes = await holdWrites(page);
    await input(page, "world_name").fill("Retry me");
    await save(page, "world_name").click();
    await expect.poll(() => writes.length).toBe(1);
    if (failure === "network") await writes[0].abort("internetdisconnected");
    else await writes[0].fulfill({ status: failure, json: { error: `Save refused ${failure}` } });

    await expect(page.getByRole("main").getByRole("alert")).toHaveText(failure === "network" ? "Failed to fetch" : `Save refused ${failure}`);
    await expect(input(page, "world_name")).toHaveValue("Retry me");
    await expect(save(page, "world_name")).toBeEnabled();

    await save(page, "world_name").click();
    await expect.poll(() => writes.length).toBe(2);
    await writes[1].continue();
    await expect(save(page, "world_name")).toHaveText("Save");
    await expect(save(page, "world_name")).toBeDisabled();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(input(page, "world_name")).toHaveValue("Retry me");
  });
}

test("successful saves preserve newer typing and keep it guarded until saved", async ({ variables: page }) => {
  const writes = await holdWrites(page);
  const prompts: string[] = [];
  page.on("dialog", async dialog => { prompts.push(dialog.message()); await dialog.dismiss(); });
  await input(page, "world_name").fill("Submitted value");
  await save(page, "world_name").click();
  await expect.poll(() => writes.length).toBe(1);
  await input(page, "world_name").fill("Newer local edit");
  await writes[0].continue();
  await expect(save(page, "world_name")).toHaveText("Save");
  await expect(save(page, "world_name")).toBeEnabled();
  await expect(input(page, "world_name")).toHaveValue("Newer local edit");
  await settleGuard(page);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("Discard unsaved changes in variable value?");
  await expect(variablesHeading(page)).toBeVisible();

  await save(page, "world_name").click();
  await expect.poll(() => writes.length).toBe(2);
  await writes[1].continue();
  await expect(save(page, "world_name")).toHaveText("Save");
  await expect(save(page, "world_name")).toBeDisabled();
  await settleGuard(page);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(variablesHeading(page)).toHaveCount(0);
  expect(prompts).toHaveLength(1);
  await page.getByRole("button", { name: "Variables", exact: true }).click();
  await expect(input(page, "world_name")).toHaveValue("Newer local edit");
});

for (const first of ["world_name", "year"]) {
  test(`concurrent saves block navigation until both settle (${first} finishes first)`, async ({ variables: page }) => {
    const writes = await holdWrites(page);
    const prompts: string[] = [];
    page.on("dialog", async dialog => { prompts.push(dialog.message()); await dialog.dismiss(); });
    await input(page, "world_name").fill("Saved name");
    await input(page, "year").fill("200");
    await save(page, "world_name").click();
    await save(page, "year").click();
    await expect.poll(() => writes.length).toBe(2);
    await expect(save(page, "world_name")).toHaveText("Saving...");
    await expect(save(page, "year")).toHaveText("Saving...");
    await settleGuard(page);
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(variablesHeading(page)).toBeVisible();
    expect(prompts).toHaveLength(0);

    const firstIndex = first === "world_name" ? 0 : 1;
    const last = first === "world_name" ? "year" : "world_name";
    await writes[firstIndex].continue();
    await expect(save(page, first)).toHaveText("Save");
    await expect(save(page, first)).toBeDisabled();
    await expect(save(page, last)).toHaveText("Saving...");
    await settleGuard(page);
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(variablesHeading(page)).toBeVisible();
    expect(prompts).toHaveLength(0);

    await writes[1 - firstIndex].continue();
    await expect(save(page, last)).toHaveText("Save");
    await expect(save(page, last)).toBeDisabled();
    await settleGuard(page);
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(variablesHeading(page)).toHaveCount(0);
    expect(prompts).toHaveLength(0);
    await page.getByRole("button", { name: "Variables", exact: true }).click();
    await expect(input(page, "world_name")).toHaveValue("Saved name");
    await expect(input(page, "year")).toHaveValue("200");
  });
}

test("hostile stored values and source stay inert while fragment formatting survives", async ({ variables: page }) => {
  const main = page.getByRole("main");
  await expect(main.locator("img")).toHaveCount(0);
  await expect(main.getByText(hostileValue, { exact: true })).toBeVisible();
  await main.locator("input:not([aria-label])").fill(`${hostileValue} [lore:fragment]`);
  await expect(main.locator("strong")).toHaveText("Bold");
  await expect(main.locator('img, script, a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => "injected" in window)).toBe(false);
});

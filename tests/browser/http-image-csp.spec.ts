import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { DEFAULT_APPEARANCE } from "../../src/lib/world-appearance";
import { assertIsolatedTestEnvironment } from "../auth-fixture";

test("reader CSP allows a supported HTTP background image", async ({ page }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  const owner = await db.user.create({ data: { name: "HTTP image CSP fixture", email: `http-csp-${randomUUID()}@example.invalid` } });
  const imageUrl = "http://nas:8080/map.png";
  const world = await db.world.create({ data: {
    ownerId: owner.id,
    title: "HTTP background image",
    slug: `http-image-${randomUUID()}`,
    isPublic: true,
    appearance: JSON.stringify({ ...DEFAULT_APPEARANCE, backgroundImage: imageUrl }),
  } });
  let imageRequested = false;
  const consoleErrors: string[] = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.route("http://nas:8080/**", async route => {
    imageRequested = true;
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCxoAAAAASUVORK5CYII=", "base64"),
    });
  });
  try {
    const response = await page.goto(`/w/${world.slug}`);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-security-policy"]).toMatch(/img-src[^;]*\bhttp:/);
    await expect.poll(() => imageRequested).toBe(true);
    const backgroundImage = await page.locator(".world-presentation").evaluate(element => getComputedStyle(element).backgroundImage);
    expect(backgroundImage).toContain(imageUrl);
    expect(consoleErrors.some(message => /content security policy|refused to load/i.test(message))).toBe(false);
  } finally {
    await db.world.delete({ where: { id: world.id } });
    await db.user.delete({ where: { id: owner.id } });
    await db.$disconnect();
  }
});

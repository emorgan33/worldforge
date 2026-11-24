import { expect, test } from "@playwright/test";

test("theme choice applies immediately and survives a reload", async ({ page }) => {
  await page.goto("/login");

  const root = page.locator("html");
  const initial = await root.getAttribute("data-theme");
  expect(["night-watch", "daylight", "system"]).toContain(initial);

  await page.getByLabel("Interface theme").selectOption("daylight");
  await expect(root).toHaveAttribute("data-theme", "daylight");

  const light = await page.locator("main").first().evaluate(el => getComputedStyle(el).backgroundColor);
  expect(light).toBe("rgb(246, 245, 243)");

  // The attribute flips optimistically; wait for the save before reloading so
  // the cookie the server reads is the one we just chose.
  await expect(page.getByLabel("Interface theme")).toBeEnabled();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "daylight");
});

test("the control is disabled while a save is in flight", async ({ page }) => {
  await page.route("**/api/preferences/theme", async route => {
    await new Promise(resolve => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.goto("/login");
  const select = page.getByLabel("Interface theme");
  await select.selectOption("daylight");
  await expect(select).toBeDisabled();
  await expect(select).toBeEnabled({ timeout: 5000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "daylight");
});

test("match system follows the operating system preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  await page.getByLabel("Interface theme").selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  const main = page.locator("main").first();
  const dark = await main.evaluate(el => getComputedStyle(el).backgroundColor);

  await page.emulateMedia({ colorScheme: "light" });
  const light = await main.evaluate(el => getComputedStyle(el).backgroundColor);

  expect(dark).not.toBe(light);
  expect(light).toBe("rgb(246, 245, 243)");
});

test("the chosen theme outranks the operating system background", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");

  await page.getByLabel("Interface theme").selectOption("night-watch");
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.getByLabel("Interface theme").selectOption("daylight");
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  expect(light).toBe("rgb(246, 245, 243)");
  expect(dark).not.toBe(light);
});

test("invalid theme values are rejected by the preference route", async ({ request, baseURL }) => {
  const response = await request.post(`${baseURL}/api/preferences/theme`, {
    data: { theme: "zinc" },
    headers: { Origin: baseURL! },
  });
  expect(response.status()).toBe(400);

  const accepted = await request.post(`${baseURL}/api/preferences/theme`, {
    data: { theme: "night-watch" },
    headers: { Origin: baseURL! },
  });
  expect(accepted.status()).toBe(200);
  expect((await accepted.json()).theme).toBe("night-watch");
});

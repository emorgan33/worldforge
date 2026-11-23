import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import PlayerHome from "@/components/player/PlayerHome";

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };

function renderPlayerHome() {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={router as never}>
      <PlayerHome name="Ada" email="ada@example.com" />
    </AppRouterContext.Provider>,
  );
}

test("player portal links back to the main site with a visible, named anchor", () => {
  const html = renderPlayerHome();
  const link = html.match(/<a[^>]*href="\/"[^>]*>.*?<\/a>/);
  assert.ok(link, "expected an anchor pointing at /");
  assert.match(link[0], />.*Back to main site.*<\/a>/);
  assert.match(link[0], /class="[^"]*\binline-flex\b/);
  assert.doesNotMatch(link[0], /class="[^"]*(?:\bhidden\b|\bsr-only\b)/);
  assert.doesNotMatch(link[0], /tabindex="-1"/);
});

test("player portal back link uses a relative same-origin URL", () => {
  const html = renderPlayerHome();
  assert.match(html, /href="\/"/);
  assert.doesNotMatch(html, /href="https?:\/\//);
});

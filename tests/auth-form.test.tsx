import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { AuthForm } from "@/components/auth/AuthForm";

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };

test("auth form sets its own dark surface so light-mode text stays readable", () => {
  for (const setup of [false, true]) {
    const html = renderToStaticMarkup(<AppRouterContext.Provider value={router as never}><AuthForm setup={setup} /></AppRouterContext.Provider>);
    assert.match(html, /<main class="[^"]*\bbg-zinc-950\b[^"]*"/);
    assert.doesNotMatch(html, /bg-zinc-850/);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { ESLint } from "eslint";

test("repo ESLint configuration handles CommonJS files without a hooks plugin error", async () => {
  const eslint = new ESLint();
  const results = await eslint.lintText("module.exports = {};\n", { filePath: "scripts/config-regression.cjs" });
  assert.equal(results[0].fatalErrorCount, 0);
  assert.equal(results[0].errorCount, 0);
});

test("repo ESLint configuration retains the hooks warning for application components", async () => {
  const eslint = new ESLint();
  const results = await eslint.lintText(`import { useEffect, useState } from "react";
export function Example() {
  const [value, setValue] = useState(0);
  useEffect(() => { setValue(1); }, []);
  return <span>{value}</span>;
}
`, { filePath: "src/components/LintRegression.tsx" });
  assert.equal(results[0].errorCount, 0);
  assert(results[0].messages.some(message => message.ruleId === "react-hooks/set-state-in-effect" && message.severity === 1));
});

test("repo ESLint configuration excludes isolated scratch copies", async () => {
  const eslint = new ESLint();
  assert.equal(await eslint.isPathIgnored(".tmp-isolated/copied-project/src/page.tsx"), true);
  assert.equal(await eslint.isPathIgnored(".tmp-review/capture.cjs"), true);
});

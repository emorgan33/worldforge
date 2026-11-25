import assert from "node:assert/strict";
import test from "node:test";
import { logServerError } from "../src/lib/logging";

test("server errors log only the operation, class and allowlisted code", () => {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => { lines.push(args.map(value => String(value)).join(" ")); };
  try {
    logServerError("Notebook request failed", new Error("Private note body: Ask the harbor master about the missing ship."));
    const coded = Object.assign(new Error("token=super-secret-setup-token"), { code: "P2002" });
    logServerError("Import failed", coded);
  } finally {
    console.error = original;
  }
  assert.deepEqual(lines, ["Notebook request failed: Error", "Import failed: Error (P2002)"]);
  assert.doesNotMatch(lines.join("\n"), /harbor master|super-secret|token=/);
});

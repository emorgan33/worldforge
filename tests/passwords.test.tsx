import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword, validPassword } from "../src/lib/passwords";
test("passwords use salted scrypt and verify without accepting altered or malformed hashes", async () => {
  const password = "A fixture passphrase 901!";
  const first = await hashPassword(password); const second = await hashPassword(password);
  assert.notEqual(first, second); assert(!first.includes(password)); assert(await verifyPassword(password, first));
  assert(!await verifyPassword("Incorrect phrase 902!", first)); assert(!await verifyPassword(password, "scrypt-v1:bad:bad"));
  assert(validPassword(password)); assert(!validPassword("short"));
});

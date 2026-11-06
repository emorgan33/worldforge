/* eslint-disable @typescript-eslint/no-require-imports */
const Database = require("better-sqlite3");

const db = new Database(":memory:");
const version = db.prepare("select sqlite_version()").pluck().get();
db.close();
const [major, minor] = version.split(".").map(Number);
if (major < 3 || (major === 3 && minor < 54)) {
  console.error(`Unpatched SQLite ${version}`);
  process.exit(1);
}
console.log(`Embedded SQLite ${version}`);

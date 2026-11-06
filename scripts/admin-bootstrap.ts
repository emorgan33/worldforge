import { PrismaClient } from "@prisma/client";
import { createSqliteAdapter } from "../src/lib/prisma-adapter";
import { bootstrapAdmin } from "../src/lib/admin-accounts";

const db = new PrismaClient({ adapter: createSqliteAdapter() });
async function main() {
  const args = process.argv.slice(2).filter(argument => argument !== "--");
  const email = args[0]?.trim().toLowerCase();
  if (!email) throw new Error("Pass an existing account email: admin:bootstrap -- existing@example.com.");
  const result = await bootstrapAdmin(db, email);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.error}`);
  console.log(`Promoted ${email} to ADMIN.`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => db.$disconnect());

import { PrismaClient } from "@prisma/client";
import { localRecoverAccount } from "../src/lib/admin-accounts";

const db = new PrismaClient();
async function main() {
  const args = process.argv.slice(2).filter(argument => argument !== "--");
  const email = args[0]?.trim().toLowerCase();
  if (!email) throw new Error("Pass a disabled account email: admin:recover -- disabled@example.com.");
  const result = await localRecoverAccount(db, email);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.error}`);
  console.log(`Recovered ${email}; credentials were revoked.`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => db.$disconnect());

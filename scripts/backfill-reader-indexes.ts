import { PrismaClient } from "@prisma/client";
import { backfillReaderReferenceIndexes } from "../src/lib/reader-reference-index";

const prisma = new PrismaClient();

async function main() {
  if (!process.argv.includes("--apply")) {
    throw new Error("This rebuilds derived reader indexes. Re-run with --apply after deploying the R17 migration.");
  }
  const worldId = process.argv.find((argument, index) => index > 1 && argument !== "--apply");
  const result = await backfillReaderReferenceIndexes(prisma, worldId);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

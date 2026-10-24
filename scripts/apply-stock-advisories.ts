import { stockArtDirectory } from "../src/lib/stock-art";
import { applyStockAdvisories, readStockAdvisoryFile, stockAdvisoryFile } from "../src/lib/stock-advisories";

async function main() {
  const root = process.argv[2] || stockArtDirectory();
  const file = stockAdvisoryFile(root);
  const { advisories, errors } = await readStockAdvisoryFile(file);
  if (errors.length) {
    for (const error of errors) console.error(`error: ${error}`);
    console.error("The advisory file is invalid; no copies were changed.");
    process.exitCode = 1;
    return;
  }
  if (!advisories.length) {
    console.log(`No advisories found in ${file}.`);
    return;
  }
  const result = await applyStockAdvisories(advisories);
  console.log(`Applied ${advisories.length} advisor${advisories.length === 1 ? "y" : "ies"}: ${result.restricted} restricted, ${result.cleared} cleared.`);
  for (const entry of result.unmatched) console.warn(`warning: no installed copies match ${entry}.`);
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  });

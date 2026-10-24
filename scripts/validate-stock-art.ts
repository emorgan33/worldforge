import { stockArtDirectory, validateStockArtCatalog } from "../src/lib/stock-art";

async function main() {
  const root = process.argv[2] || stockArtDirectory();
  const result = await validateStockArtCatalog({ root });
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (!result.ok) {
    for (const error of result.errors) console.error(`error: ${error}`);
    console.error(`Stock-art catalog validation failed with ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Stock-art catalog is valid: ${result.catalog?.entries.length || 0} entries, revision ${result.catalog?.catalogRevision || "unknown"}, manifest ${result.manifestDigest}.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

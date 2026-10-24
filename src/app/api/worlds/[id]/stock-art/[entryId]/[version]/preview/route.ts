import { withAuthor } from "@/lib/auth";
import { findStockArtEntry, loadStockArtCatalog, readStockArtImage, stockArtDirectory, StockArtError } from "@/lib/stock-art";

function failure(error: unknown) {
  if (error instanceof StockArtError) return new Response(error.message, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
  console.error("Stock-art preview request failed", error);
  return new Response("Artwork preview unavailable", { status: 500, headers: { "Cache-Control": "private, no-store" } });
}

async function getHandler(request: Request, context: { params: Promise<{ id: string; entryId: string; version: string }> }) {
  try {
    const { entryId, version: rawVersion } = await context.params;
    const version = Number(rawVersion);
    if (!Number.isSafeInteger(version) || version < 1) throw new StockArtError("Choose a valid artwork version.");
    const size = new URL(request.url).searchParams.get("size") === "full" ? "image" : "thumbnail";
    const { catalog } = await loadStockArtCatalog();
    const entry = findStockArtEntry(catalog, entryId, version);
    if (!entry) throw new StockArtError("This artwork is not in the installed catalog.", 404);
    const bytes = await readStockArtImage(stockArtDirectory(), entry, size);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(bytes.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Vary": "Accept-Encoding",
      },
    });
  } catch (error) {
    return failure(error);
  }
}

export const GET = withAuthor(getHandler);

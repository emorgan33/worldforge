import { withAuthor } from "@/lib/auth";
import { AccessError } from "@/lib/auth";
import { NextResponse } from "next/server";
import { exportWorldTransfer, WorldTransferExecutionError } from "@/lib/world-transfer-execution";
import { WorldTransferExportError } from "@/lib/world-transfer-v1-export";

function failure(error: unknown) {
  if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof WorldTransferExecutionError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof WorldTransferExportError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Failed to export world:", error);
  return NextResponse.json({ error: "Failed to export world" }, { status: 500 });
}

export const GET = withAuthor({ target: "world-param" }, async (request: Request, { params }: { params: Promise<{ id: string }> }, { user }) => {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "v4";
    if (format !== "v1" && format !== "v2" && format !== "v3" && format !== "v4") return NextResponse.json({ error: "Unsupported export format" }, { status: 400 });

    if (format === "v4") {
      if (url.searchParams.has("includeAssets") || url.searchParams.has("includePrivate")) return NextResponse.json({ error: "Format 4 is a complete backup and does not support filtering flags." }, { status: 400 });
      const data = await exportWorldTransfer(id, 4, "", { includeAssets: true, includePrivate: true });
      return NextResponse.json(data, { headers: { "Content-Disposition": `attachment; filename="${data.world.slug}-export-v4.json"`, "Accept-Version": "4" } });
    }

    if (format === "v3") {
      if (url.searchParams.has("includeAssets") || url.searchParams.has("includePrivate")) {
        return NextResponse.json({ error: "Format 3 is a complete backup and does not support includeAssets/includePrivate filters. Format 1 filtered exports are unavailable because they cannot safely remove all private content." }, { status: 400 });
      }
      const data = await exportWorldTransfer(id, 3, "", { includeAssets: true, includePrivate: true });
      return NextResponse.json(data, { headers: { "Content-Disposition": `attachment; filename="${data.world.slug}-export-v3.json"`, "Accept-Version": "3" } });
    }

    if (format === "v2" && (url.searchParams.has("includeAssets") || url.searchParams.has("includePrivate"))) {
      return NextResponse.json({ error: "Format 2 is a complete backup and does not support includeAssets/includePrivate filters. Format 1 filtered exports are unavailable because they cannot safely remove all private content." }, { status: 400 });
    }
    if (format === "v2") {
      const data = await exportWorldTransfer(id, 2, "", { includeAssets: true, includePrivate: true });
      return NextResponse.json(data, { headers: { "Content-Disposition": `attachment; filename="${data.world.slug}-export-v2.json"`, "Accept-Version": "2" } });
    }

    const data = await exportWorldTransfer(id, 1, user.id, { includeAssets: url.searchParams.get("includeAssets") !== "false", includePrivate: url.searchParams.get("includePrivate") !== "false" });
    return NextResponse.json(data, { headers: { "Content-Disposition": `attachment; filename="${data.world.slug}-export.json"` } });
  } catch (error) { return failure(error); }
});

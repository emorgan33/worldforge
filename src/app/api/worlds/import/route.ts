import { withAuthor, sessionUser } from "@/lib/auth";
import { AccessError } from "@/lib/auth";
import { NextResponse } from "next/server";
import { importWorldTransfer } from "@/lib/world-transfer-execution";
import { readWorldTransferJson } from "@/lib/world-transfer-adapters";

export const POST = withAuthor(async (request: Request) => {
  try {
    const user = await sessionUser();
    if (!user) throw new AccessError("You must be signed in", 401);

    let body: unknown;
    try { body = await readWorldTransferJson(request); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid JSON file" }, { status: 400 }); }
    const result = await importWorldTransfer(body, user.id);
    if (!result.success) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Failed to import world:", error);
    return NextResponse.json({ error: "Failed to import world" }, { status: 500 });
  }
});

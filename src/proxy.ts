import { NextResponse } from "next/server";

export function proxy() {
  const response = NextResponse.next();
  if (process.env.WORLDFORGE_ORIGIN?.startsWith("https://")) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  return response;
}

export const config = { matcher: ["/((?!api/|_next/).*)"] };

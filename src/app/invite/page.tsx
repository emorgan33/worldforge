"use client";

import { useEffect, useState } from "react";
import InviteClaimForm from "@/components/player/InviteClaimForm";

export default function InvitationPage() {
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", window.location.pathname);
    setToken(value);
  }, []);

  if (token === undefined) return <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 text-zinc-100"><p role="status" className="text-zinc-400">Opening invitation…</p></main>;
  return <InviteClaimForm token={token ?? ""} />;
}

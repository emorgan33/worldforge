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

  if (token === undefined) return <main className="flex min-h-screen items-center justify-center bg-app-canvas px-5 text-app-text-strong"><p role="status" className="text-app-muted">Opening invitation…</p></main>;
  return <InviteClaimForm token={token ?? ""} />;
}

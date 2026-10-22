"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, MailPlus, RefreshCw, UserMinus, X } from "lucide-react";

type Member = { id: string; userId?: string; name?: string | null; email?: string | null; role?: string; user?: { id?: string; name?: string | null; email?: string | null } };
type Invitation = { id: string; email: string; status?: string; createdAt?: string; expiresAt?: string | null; claimUrl?: string };

export function MemberManager({ worldId }: { worldId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [claimUrl, setClaimUrl] = useState("");

  const refresh = useCallback(async () => {
    const [memberResponse, inviteResponse] = await Promise.all([
      fetch(`/api/worlds/${worldId}/members`),
      fetch(`/api/worlds/${worldId}/invitations`),
    ]);
    if (!memberResponse.ok || !inviteResponse.ok) throw new Error("Could not load campaign members.");
    const memberData = await memberResponse.json();
    const inviteData = await inviteResponse.json();
    const memberRows = Array.isArray(memberData) ? memberData : memberData.members ?? [];
    setMembers(memberRows.map((row: Member) => ({ ...row, userId: row.userId || row.user?.id, name: row.name || row.user?.name, email: row.email || row.user?.email })));
    setInvitations(Array.isArray(inviteData.invitations) ? inviteData.invitations : []);
  }, [worldId]);

  useEffect(() => { refresh().catch(error => setError(error.message)); }, [refresh]);

  async function invite(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/worlds/${worldId}/invitations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create invitation link.");
      setEmail(""); setClaimUrl(data.claimUrl || ""); setNotice("Link created. Copy and share it with the invited player."); await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not create invitation link."); }
    finally { setBusy(false); }
  }

  async function remove(path: string, label: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(path, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Could not ${label}.`);
      await refresh(); setNotice(label === "cancel invitation" ? "Invitation canceled." : "Member access revoked.");
    } catch (error) { setError(error instanceof Error ? error.message : `Could not ${label}.`); }
    finally { setBusy(false); }
  }

  async function copyLink(url: string) {
    try { await navigator.clipboard.writeText(new URL(url, window.location.origin).href); setNotice("Invite link copied."); }
    catch { setError("Could not copy the invitation link."); }
  }

  async function resend(address: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/worlds/${worldId}/invitations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: address }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not refresh invitation link.");
      setClaimUrl(data.claimUrl || ""); setNotice(`New link ready for ${address}. Copy and share it.`); await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not refresh invitation link."); }
    finally { setBusy(false); }
  }

  return <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
    <div className="flex items-center justify-between gap-3"><div><h3 className="font-serif text-xl text-amber-100">Players & invitations</h3><p className="mt-1 text-xs text-zinc-500">Create a link, then copy and share it with the player. WorldForge does not send email.</p></div><span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300">{members.length} active</span></div>
    <form onSubmit={invite} className="mt-4 flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor="member-invite-email">Email address</label><input id="member-invite-email" type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="player@example.com" className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"/><button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-500 disabled:opacity-50"><MailPlus size={15}/>Create link</button></form>
    {claimUrl && <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3 text-xs"><span className="truncate text-emerald-200">Invitation link ready to share</span><button onClick={() => copyLink(claimUrl)} className="inline-flex shrink-0 items-center gap-1.5 text-emerald-300 hover:text-emerald-100"><Copy size={13}/>Copy</button></div>}
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <div><h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Active members</h4>{members.length ? <ul className="space-y-2">{members.map(member => <li key={member.userId || member.id} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-950/60 px-3 py-2"><span className="min-w-0"><span className="block truncate text-sm text-zinc-200">{member.name || member.email || "Player"}</span>{member.name && member.email && <span className="block truncate text-xs text-zinc-500">{member.email}</span>}</span><button title="Revoke member access" aria-label={`Revoke access for ${member.email || member.name || "member"}`} disabled={busy} onClick={() => remove(`/api/worlds/${worldId}/members/${member.userId || member.id}`, "revoke member access")} className="rounded p-1.5 text-zinc-500 hover:bg-red-950/50 hover:text-red-300 disabled:opacity-50"><UserMinus size={15}/></button></li>)}</ul> : <p className="text-xs text-zinc-500">No active players yet.</p>}</div>
      <div><h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Pending invitations</h4>{invitations.length ? <ul className="space-y-2">{invitations.map(invite => <li key={invite.id} className="flex items-center justify-between gap-2 rounded-lg bg-zinc-950/60 px-3 py-2"><span className="min-w-0"><span className="block truncate text-sm text-zinc-200">{invite.email}</span><span className="block text-xs text-amber-500">Pending</span></span><div className="flex shrink-0 gap-1"><button title="Create a new link" aria-label={`Create a new invitation link for ${invite.email}`} disabled={busy} onClick={() => resend(invite.email)} className="rounded p-1.5 text-zinc-500 hover:text-amber-300 disabled:opacity-50"><RefreshCw size={14}/></button>{invite.claimUrl && <button title="Copy invitation link" aria-label={`Copy invitation link for ${invite.email}`} onClick={() => copyLink(invite.claimUrl!)} className="rounded p-1.5 text-zinc-500 hover:text-amber-300"><Copy size={14}/></button>}<button title="Cancel invitation" aria-label={`Cancel invitation to ${invite.email}`} disabled={busy} onClick={() => remove(`/api/worlds/${worldId}/invitations/${invite.id}`, "cancel invitation")} className="rounded p-1.5 text-zinc-500 hover:text-red-300"><X size={14}/></button></div></li>)}</ul> : <p className="text-xs text-zinc-500">No pending invitations.</p>}</div>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}{notice && <p role="status" className="mt-3 flex items-center gap-1 text-xs text-emerald-300"><Check size={13}/>{notice}</p>}
  </section>;
}

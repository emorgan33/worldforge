"use client";

import { useEffect, useState } from "react";
import { Check, LockKeyhole, Save, Users } from "lucide-react";

type Member = { id: string; userId?: string; name?: string | null; email?: string | null; user?: { id?: string; name?: string | null; email?: string | null } };
type Mode = "GM_ONLY" | "PLAYER_SNAPSHOT" | "PUBLIC";

export function ShareResource({ kind, resourceId, title }: { kind: string; resourceId: string; title: string }) {
  const [mode, setMode] = useState<Mode>("GM_ONLY");
  const [userIds, setUserIds] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const endpoint = `/api/resources/${encodeURIComponent(kind)}/${encodeURIComponent(resourceId)}/audience`;

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load sharing settings.");
      if (controller.signal.aborted) return;
      setError("");
      if (["GM_ONLY", "PLAYER_SNAPSHOT", "PUBLIC"].includes(data.mode)) setMode(data.mode);
      setUserIds(Array.isArray(data.userIds) ? data.userIds : []);
      setMembers(Array.isArray(data.members) ? data.members.map((member: Member) => ({ ...member, userId: member.userId || member.user?.id, name: member.name || member.user?.name, email: member.email || member.user?.email })) : []);
      setLoaded(true);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, [endpoint]);

  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, userIds: mode === "PLAYER_SNAPSHOT" ? userIds : [] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save sharing settings.");
      if (["GM_ONLY", "PLAYER_SNAPSHOT", "PUBLIC"].includes(data.mode)) setMode(data.mode);
      setUserIds(Array.isArray(data.userIds) ? data.userIds : mode === "PLAYER_SNAPSHOT" ? userIds : []);
      setMembers(Array.isArray(data.members) ? data.members : members);
      setNotice("Access settings saved.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save sharing settings."); }
    finally { setBusy(false); }
  }

  const selected = members.filter(member => userIds.includes(member.userId || member.id));
  return <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
    <div className="flex items-start gap-3"><LockKeyhole size={18} className="mt-1 text-amber-500"/><div><h3 className="font-serif text-lg text-amber-100">Share “{title}”</h3><p className="mt-1 text-xs text-zinc-500">Set exactly which campaign members can read this resource. Share embedded images and statblocks separately in their libraries.</p></div></div>
    {!loaded && !error ? <p className="mt-4 text-sm text-zinc-500">Loading access settings…</p> : <>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">{([
        ["GM_ONLY", "GM only", "Only the GM can read it."],
        ["PLAYER_SNAPSHOT", "Selected players", "Choose specific active members."],
        ["PUBLIC", "All campaign players", "Every active member can read it."],
      ] as const).map(([value, label, detail]) => <label key={value} className={`cursor-pointer rounded-lg border p-3 ${mode === value ? "border-amber-600/70 bg-amber-950/20" : "border-zinc-800 bg-zinc-950/40"}`}><span className="flex items-center gap-2 text-sm font-medium text-zinc-200"><input type="radio" name={`audience-${resourceId}`} checked={mode === value} onChange={() => setMode(value)} className="accent-amber-500"/>{label}</span><span className="mt-1 block pl-6 text-[11px] leading-relaxed text-zinc-500">{detail}</span></label>)}</div>
      {mode === "PLAYER_SNAPSHOT" && <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3"><p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500"><Users size={13}/> Allowed members</p>{members.length ? <div className="grid gap-2 sm:grid-cols-2">{members.map(member => { const id = member.userId || member.id; return <label key={id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"><input type="checkbox" checked={userIds.includes(id)} onChange={event => setUserIds(previous => event.target.checked ? [...new Set([...previous, id])] : previous.filter(userId => userId !== id))} className="accent-amber-500"/><span className="truncate">{member.name || member.email || "Player"}</span>{member.name && member.email && <span className="truncate text-xs text-zinc-600">{member.email}</span>}</label>; })}</div> : <p className="text-xs text-zinc-500">Invite players to this campaign before granting access.</p>}{selected.length > 0 && <p className="mt-3 border-t border-zinc-800 pt-2 text-xs text-amber-200">Can read: {selected.map(member => member.name || member.email || "Player").join(", ")}</p>}</div>}
      <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" onClick={save} disabled={busy || !loaded} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-500 disabled:opacity-50"><Save size={14}/>{busy ? "Saving…" : "Save access"}</button>{error && <p role="alert" className="text-sm text-red-300">{error}</p>}{notice && <p role="status" className="flex items-center gap-1 text-xs text-emerald-300"><Check size={13}/>{notice}</p>}</div>
    </>}
  </section>;
}

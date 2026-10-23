"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type InvitationData = { invitation: { email: string; worldTitle: string; expiresAt: string }; accountExists: boolean; signedInEmail?: string | null };

export default function InviteClaimForm({ token }: { token: string }) {
  const router = useRouter();
  const [details, setDetails] = useState<InvitationData | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (!token) return;
    fetch("/api/invitations/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "This invitation is invalid or has expired.");
        if (active) { setDetails(data); setEmail(data.invitation.email); }
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Could not open this invitation."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const invitationError = token ? error : "This invitation link is missing its token. Please open the complete link you received.";

  const signedInMatches = !!details?.signedInEmail && details.signedInEmail.toLowerCase() === details.invitation.email.toLowerCase();
  const signedInMismatch = !!details?.signedInEmail && !signedInMatches;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details) return;
    setBusy(true); setError("");
    try {
      if (details.accountExists && !signedInMatches) {
        if (email.trim().toLowerCase() !== details.invitation.email.toLowerCase()) throw new Error("Use the email address this invitation was sent to.");
        const login = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: details.invitation.email, password: signInPassword }) });
        const loginData = await login.json();
        if (!login.ok) throw new Error(loginData.error || "Unable to sign in.");
      }
      const response = await fetch("/api/invitations/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...(details.accountExists ? {} : { name, password }) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to accept this invitation.");
      router.replace(data.worldSlug ? `/c/${data.worldSlug}` : "/player");
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to accept this invitation."); }
    finally { setBusy(false); }
  }

  async function signOut() {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) { setError("Could not sign out. Try again."); return; }
    setDetails(previous => previous ? { ...previous, signedInEmail: null } : previous);
    router.refresh();
  }

  return <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 py-10 text-zinc-100"><section className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-7 shadow-2xl">
    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">WorldForge · Invitation</p>
    <h1 className="mt-3 font-serif text-3xl font-bold">Join a world</h1>
    {token && loading ? <p role="status" className="mt-5 text-zinc-400">Checking your invitation…</p> : invitationError && !details ? <div className="mt-5 space-y-5"><p role="alert" className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">{invitationError}</p><Link href="/login" className="text-sm text-indigo-300 hover:underline">Go to sign in</Link></div> : details && <>
      <p className="mt-3 text-zinc-300">You’ve been invited to <strong className="text-amber-200">{details.invitation.worldTitle}</strong>.</p>
      <form className="mt-7 space-y-5" onSubmit={submit}>
        {error && <p role="alert" className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
        {signedInMismatch ? <div className="space-y-3 rounded-lg border border-amber-800/60 bg-amber-950/20 p-4"><p className="text-sm text-amber-100">You’re signed in as <strong>{details.signedInEmail}</strong>. This invitation was sent to {details.invitation.email}.</p><button type="button" onClick={signOut} className="text-sm text-indigo-300 underline">Sign out to use the invited account</button></div> : <>
          <label className="block text-sm font-semibold text-zinc-200">Email<input type="email" required readOnly value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-zinc-100 read-only:text-zinc-400" /></label>
          {details.accountExists ? signedInMatches ? <p className="rounded-lg border border-emerald-900 bg-emerald-950/30 p-3 text-sm text-emerald-200">Signed in as the invited account. You can accept the invitation.</p> : <label className="block text-sm font-semibold text-zinc-200">Password<input type="password" required autoComplete="current-password" value={signInPassword} onChange={event => setSignInPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-zinc-100" /></label> : <>
            <label className="block text-sm font-semibold text-zinc-200">Your name<input type="text" required maxLength={100} autoComplete="name" value={name} onChange={event => setName(event.target.value)} placeholder="How others will see you" className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-zinc-100 placeholder:text-zinc-600" /></label>
            <label className="block text-sm font-semibold text-zinc-200">Create a password<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 12 characters" className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-zinc-100 placeholder:text-zinc-600" /></label>
          </>}
          <button disabled={busy || (signedInMismatch)} className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-bold hover:bg-indigo-500 disabled:opacity-50">{busy ? "Joining…" : "Accept invitation"}</button>
        </>}
      </form>
      <p className="mt-5 text-xs text-zinc-500">Invitation for {details.invitation.email}</p>
    </>}
  </section></main>;
}

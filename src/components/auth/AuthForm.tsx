"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
export function AuthForm({ setup = false }: { setup?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [token, setToken] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  useEffect(() => { if (initialized.current) return; initialized.current = true; if (setup) { const hash = new URLSearchParams(window.location.hash.slice(1)); setToken(hash.get("token") || ""); window.history.replaceState(null, "", window.location.pathname); } }, [setup]);
  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-zinc-950 p-8 text-white">
    <h1 className="font-serif text-3xl font-bold text-amber-200">{setup ? "Set up your author account" : "Sign in to WorldForge"}</h1>
    <p className="mt-3 leading-relaxed text-zinc-300">{setup ? "Choose the email and password you\u2019ll use to access your author workspace." : "Your author workspace is private. Public world pages are available without signing in."}</p>
    <form className="mt-8 space-y-5" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(""); try { const response = await fetch(`/api/auth/${setup ? "setup" : "login"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, ...(setup ? { token } : {}) }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); router.replace("/"); router.refresh(); } catch (error) { setError(error instanceof Error ? error.message : "Unable to sign in."); } finally { setBusy(false); } }}>
      {error && <p role="alert" className="rounded-lg border border-red-700 bg-red-950/30 px-4 py-2 text-sm text-red-300">{error}</p>}
      <label className="block text-sm font-semibold text-zinc-200">Email
        <input aria-label="Email" autoComplete="username" type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" className="mt-1.5 w-full rounded-lg border border-zinc-600 bg-zinc-900 p-3 text-zinc-100 placeholder-zinc-500" />
      </label>
      <label className="block text-sm font-semibold text-zinc-200">Password
        <input aria-label="Password" type="password" required minLength={12} maxLength={128} autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} placeholder={setup ? "At least 12 characters" : "Your password"} className="mt-1.5 w-full rounded-lg border border-zinc-600 bg-zinc-900 p-3 text-zinc-100 placeholder-zinc-500" />
      </label>
      {setup && !token && <p role="alert" className="rounded-lg border border-amber-800/50 bg-amber-950/20 px-4 py-2 text-sm text-amber-300">Open the one-time setup link created on the server. This page cannot claim an account without that link.</p>}
      <button disabled={busy || (setup && !token)} className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-base font-bold text-white hover:bg-indigo-500 disabled:opacity-40">{busy ? "Please wait\u2026" : setup ? "Set password & open workspace" : "Sign in"}</button>
    </form>
    {!setup && <p className="mt-6 text-xs leading-relaxed text-zinc-400">For first-time setup or password recovery, the server administrator can generate a one-time account link.</p>}
  </main>;
}

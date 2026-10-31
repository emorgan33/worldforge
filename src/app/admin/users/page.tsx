"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SafeAccount } from "@/lib/admin-policy";

type SetupLink = { url: string; expiresAt: string };

export default function AdminUsersPage() {
  const [users, setUsers] = useState<SafeAccount[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const requestSeq = useRef(0);

  const [searchDraft, setSearchDraft] = useState("");
  const [roleDraftFilter, setRoleDraftFilter] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "AUTHOR" });
  const [setupLink, setSetupLink] = useState<SetupLink | null>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (!setupLink) return;
    const clear = () => setSetupLink(null);
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) clear();
    };
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest("a[href]")) clear();
    };
    window.addEventListener("pagehide", clear);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("popstate", clear);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("popstate", clear);
      document.removeEventListener("click", onClick, true);
    };
  }, [setupLink]);

  async function loadUsers(cursor?: string | null, replace = true, filters = { search, role, status }) {
    const requestId = ++requestSeq.current;
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.role) params.set("role", filters.role);
    if (filters.status) params.set("status", filters.status);
    if (cursor) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/admin/users?${params.toString()}`);
      let data: { users?: SafeAccount[]; nextCursor?: string | null; error?: string } = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }
      if (requestId !== requestSeq.current) return;
      if (!response.ok) {
        setError(data.error || "Unable to load accounts.");
        return;
      }
      setUsers((previous) => (replace ? data.users || [] : [...previous, ...(data.users || [])]));
      setNextCursor(data.nextCursor ?? null);
    } catch {
      if (requestId !== requestSeq.current) return;
      setError("Unable to confirm this request. The account list has been refreshed; retry if needed.");
      try {
        const response = await fetch("/api/admin/users");
        const data = await response.json();
        if (requestId !== requestSeq.current) return;
        if (response.ok) {
          setUsers(data.users || []);
          setNextCursor(data.nextCursor ?? null);
        }
      } catch {
        // Leave the current list in place; controls are restored below.
      }
    } finally {
      if (requestId === requestSeq.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchDraft);
    setRole(roleDraftFilter);
    setStatus(statusDraft);
    await loadUsers(null, true, { search: searchDraft, role: roleDraftFilter, status: statusDraft });
  }

  async function createAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      let data: { user?: SafeAccount; setup?: SetupLink; error?: string } = {};
      let parseFailed = false;
      try {
        data = await response.json();
      } catch {
        parseFailed = true;
        data = {};
      }
      if (!response.ok) {
        setError(data.error || "Unable to create account.");
        return;
      }
      if (parseFailed || !data.user || !data.setup?.url) {
        await loadUsers();
        setError("Unable to confirm whether account creation succeeded. The list has been refreshed; do not resubmit until you verify whether it succeeded.");
        return;
      }
      setUsers((previous) => [data.user as SafeAccount, ...previous]);
      if (data.setup) setSetupLink(data.setup);
      setForm({ email: "", name: "", role: "AUTHOR" });
      setShowCreate(false);
    } catch {
      await loadUsers();
      setError("Unable to confirm account creation. The list has been refreshed; do not resubmit until you verify whether it succeeded.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-amber-100">Accounts</h2>
          <p className="mt-1 text-sm text-zinc-400">Create, inspect, and manage installation accounts.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((value) => !value)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
        >
          {showCreate ? "Cancel" : "Create account"}
        </button>
      </div>

      {setupLink && (
        <section role="status" aria-live="polite" className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-4">
          <h3 className="font-semibold text-emerald-200">One-time setup link</h3>
          <p className="mt-1 text-sm text-emerald-100/80">
            Copy this link now. It is shown only once and will not be available again.
          </p>
          <div className="mt-3 flex flex-col gap-2 md:flex-row">
            <input
              readOnly
              aria-label="One-time setup link"
              value={setupLink.url}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-emerald-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100"
            />
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(setupLink.url)}
              className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setSetupLink(null)}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              I have saved it
            </button>
          </div>
          <p className="mt-2 text-xs text-emerald-100/70">Expires {new Date(setupLink.expiresAt).toLocaleString()}.</p>
        </section>
      )}

      {showCreate && (
        <form onSubmit={createAccount} className="grid gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 md:grid-cols-4">
          <label className="text-sm font-medium text-zinc-200 md:col-span-1">
            Email
            <input
              required
              type="email"
              maxLength={254}
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
            />
          </label>
          <label className="text-sm font-medium text-zinc-200 md:col-span-1">
            Name
            <input
              required
              maxLength={120}
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
            />
          </label>
          <label className="text-sm font-medium text-zinc-200 md:col-span-1">
            Role
            <select
              value={form.role}
              onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
            >
              <option value="AUTHOR">AUTHOR</option>
              <option value="PLAYER">PLAYER</option>
            </select>
          </label>
          <div className="flex items-end md:col-span-1">
            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      )}

      <form onSubmit={applyFilters} className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 md:grid-cols-4">
        <label className="text-sm font-medium text-zinc-200 md:col-span-2">
          Search
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Email or name"
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
        </label>
        <label className="text-sm font-medium text-zinc-200">
          Role
          <select
            value={roleDraftFilter}
            onChange={(event) => setRoleDraftFilter(event.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          >
            <option value="">All roles</option>
            <option value="ADMIN">ADMIN</option>
            <option value="AUTHOR">AUTHOR</option>
            <option value="GM">GM</option>
            <option value="PLAYER">PLAYER</option>
          </select>
        </label>
        <label className="text-sm font-medium text-zinc-200">
          Status
          <select
            value={statusDraft}
            onChange={(event) => setStatusDraft(event.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <div className="md:col-span-4">
          <button
            type="submit"
            disabled={loading || loadingMore}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
          >
            Apply filters
          </button>
        </div>
      </form>

      {error && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300 focus:outline-none">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/70 text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Setup</th>
              <th className="px-3 py-2">Last sign-in</th>
              <th className="px-3 py-2">Version</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-zinc-800/70 hover:bg-zinc-900/40">
                <td className="px-3 py-2">
                  <Link href={`/admin/users/${user.id}`} className="text-indigo-300 hover:text-indigo-200">
                    {user.email}
                  </Link>
                </td>
                <td className="px-3 py-2">{user.name}</td>
                <td className="px-3 py-2">{user.role}</td>
                <td className="px-3 py-2">{user.disabledAt ? "Disabled" : "Active"}</td>
                <td className="px-3 py-2">{user.setupPending ? "Pending" : "Complete"}</td>
                <td className="px-3 py-2">{user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleString() : "Unknown"}</td>
                <td className="px-3 py-2">{user.accountVersion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && <p className="text-sm text-zinc-400">Loading accounts…</p>}
      {!loading && users.length === 0 && <p className="text-sm text-zinc-400">No accounts match these filters.</p>}
      {nextCursor && (
        <button
          type="button"
          disabled={loading || loadingMore}
          onClick={() => void loadUsers(nextCursor, false)}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}

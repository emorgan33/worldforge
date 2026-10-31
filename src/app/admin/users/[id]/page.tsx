"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { SafeAccount } from "@/lib/admin-policy";

type Detail = {
  account: SafeAccount;
  worlds: { id: string; title: string; deletedAt: string | null }[];
  membershipCount: number;
  grantCount: number;
  sessionCount: number;
  setupCount: number;
  previewCount: number;
};

type Session = { id: string; createdAt: string; expiresAt: string; current: boolean };
type Sessions = { sessions: Session[]; previewSubjectCount: number; previewIssuerCount: number };

type DeletionPreview = {
  accountVersion: number;
  disabled: boolean;
  worlds: { id: string; title: string; deletedAt: string | null }[];
  revisionIds: string[];
  foundryImportIds: string[];
  pendingImportIds: string[];
  membershipCount: number;
  grantCount: number;
  sessionCount: number;
  setupCount: number;
  previewCount: number;
  allowed: boolean;
};

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [sessions, setSessions] = useState<Sessions | null>(null);
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [roleDraft, setRoleDraft] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
  const [setupLink, setSetupLink] = useState<{ url: string; expiresAt: string } | null>(null);

  async function loadDetail() {
    const response = await fetch(`/api/admin/users/${id}`);
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Unable to load account.");
      return false;
    }
    setDetail(data);
    setRoleDraft(data.account.role);
    return true;
  }

  async function loadSessions() {
    const response = await fetch(`/api/admin/users/${id}/sessions`);
    const data = await response.json();
    if (response.ok) setSessions(data);
  }

  async function loadPreview() {
    const response = await fetch(`/api/admin/users/${id}/deletion-preview`);
    const data = await response.json();
    if (response.ok) setPreview(data);
    else setError(data.error || "Unable to load deletion preview.");
  }

  useEffect(() => {
    void (async () => {
      const ok = await loadDetail();
      if (ok) await loadSessions();
    })();
  }, [id]);

  async function mutate(url: string, body: unknown, onSuccess?: () => Promise<void>) {
    setBusy(true);
    setError("");
    const response = await fetch(url, {
      method: url.endsWith("/revoke-all") ? "POST" : url.includes("/sessions/") ? "DELETE" : url.endsWith("/recovery") ? "POST" : url.endsWith("/status") || url.endsWith("/role") ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      if (data.code === "STALE_ACCOUNT") await loadDetail();
      setError(data.error || "Unable to complete this request.");
      setBusy(false);
      return false;
    }
    if (data.setup) setSetupLink(data.setup);
    if (onSuccess) await onSuccess();
    await loadDetail();
    await loadSessions();
    setBusy(false);
    return true;
  }

  if (!detail && !error) return <p className="text-sm text-zinc-400">Loading account…</p>;
  if (error && !detail) return <p role="alert" className="text-sm text-red-300">{error}</p>;
  if (!detail) return null;
  const account = detail.account;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/users" className="text-sm text-indigo-300 hover:text-indigo-200">← Accounts</Link>
          <h2 className="mt-2 text-2xl font-bold text-amber-100">{account.email}</h2>
          <p className="text-sm text-zinc-400">{account.name} · {account.role} · {account.disabledAt ? "Disabled" : "Active"}</p>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</p>}

      {setupLink && (
        <section role="status" aria-live="polite" className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-4">
          <h3 className="font-semibold text-emerald-200">One-time setup link</h3>
          <p className="mt-1 text-sm text-emerald-100/80">Copy this link now. It is shown only once.</p>
          <div className="mt-3 flex flex-col gap-2 md:flex-row">
            <input readOnly value={setupLink.url} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-emerald-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100" />
            <button type="button" onClick={() => void navigator.clipboard?.writeText(setupLink.url)} className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">Copy</button>
            <button type="button" onClick={() => setSetupLink(null)} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">I have saved it</button>
          </div>
          <p className="mt-2 text-xs text-emerald-100/70">Expires {new Date(setupLink.expiresAt).toLocaleString()}.</p>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h3 className="font-semibold text-zinc-100">Identity</h3>
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-zinc-400">ID</dt><dd className="break-all text-right">{account.id}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-zinc-400">Email</dt><dd>{account.email}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-zinc-400">Name</dt><dd>{account.name}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-zinc-400">Created</dt><dd>{new Date(account.createdAt).toLocaleString()}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-zinc-400">Last sign-in</dt><dd>{account.lastSignInAt ? new Date(account.lastSignInAt).toLocaleString() : "Unknown"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-zinc-400">Setup pending</dt><dd>{account.setupPending ? "Yes" : "No"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-zinc-400">Account version</dt><dd>{account.accountVersion}</dd></div>
          </dl>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h3 className="font-semibold text-zinc-100">Role and status</h3>
          <div className="mt-3 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={roleDraft}
                onChange={(event) => setRoleDraft(event.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="ADMIN">ADMIN</option>
                <option value="AUTHOR">AUTHOR</option>
                <option value="GM">GM</option>
                <option value="PLAYER">PLAYER</option>
              </select>
              <button
                type="button"
                disabled={busy || roleDraft === account.role}
                onClick={() => {
                  if (!window.confirm(`Change role to ${roleDraft}?`)) return;
                  void mutate(`/api/admin/users/${id}/role`, { role: roleDraft, expectedVersion: account.accountVersion });
                }}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
              >
                Change role
              </button>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const nextDisabled = !account.disabledAt;
                if (!window.confirm(nextDisabled ? "Disable this account and revoke its credentials?" : "Re-enable this account?")) return;
                void mutate(`/api/admin/users/${id}/status`, { disabled: nextDisabled, expectedVersion: account.accountVersion });
              }}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              {account.disabledAt ? "Enable account" : "Disable account"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm("Issue a new one-time setup link and invalidate previous unused links?")) return;
                void mutate(`/api/admin/users/${id}/recovery`, { expectedVersion: account.accountVersion });
              }}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              Issue recovery link
            </button>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="font-semibold text-zinc-100">Owned worlds</h3>
        {detail.worlds.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">No owned worlds.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {detail.worlds.map((world) => (
              <li key={world.id} className="flex justify-between gap-4 rounded-lg border border-zinc-800 px-3 py-2">
                <span>{world.title}</span>
                <span className="text-zinc-400">{world.deletedAt ? "Archived" : "Active"} · {world.id}</span>
              </li>
            ))}
          </ul>
        )}
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
          <div><dt className="text-zinc-400">Memberships</dt><dd>{detail.membershipCount}</dd></div>
          <div><dt className="text-zinc-400">Grants</dt><dd>{detail.grantCount}</dd></div>
          <div><dt className="text-zinc-400">Setup links</dt><dd>{detail.setupCount}</dd></div>
          <div><dt className="text-zinc-400">Preview capabilities</dt><dd>{detail.previewCount}</dd></div>
        </dl>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-zinc-100">Sessions</h3>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("Revoke all login sessions and related preview capabilities?")) return;
              void mutate(`/api/admin/users/${id}/sessions/revoke-all`, { expectedVersion: account.accountVersion }, async () => undefined);
            }}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
          >
            Revoke all access
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-400">
          Preview capabilities: {sessions?.previewSubjectCount ?? 0} as subject, {sessions?.previewIssuerCount ?? 0} as issuer.
        </p>
        <div className="mt-3 space-y-2">
          {(sessions?.sessions || []).map((session) => (
            <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 px-3 py-2 text-sm">
              <div>
                <p className="font-mono text-xs text-zinc-300">{session.id}</p>
                <p className="text-xs text-zinc-400">
                  Created {new Date(session.createdAt).toLocaleString()} · Expires {new Date(session.expiresAt).toLocaleString()}
                  {session.current ? " · Current session" : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm("Revoke this session?")) return;
                  void mutate(`/api/admin/users/${id}/sessions/${session.id}`, { expectedVersion: account.accountVersion });
                }}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
              >
                Revoke
              </button>
            </div>
          ))}
          {sessions && sessions.sessions.length === 0 && <p className="text-sm text-zinc-400">No active sessions.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-red-900/60 bg-red-950/10 p-4">
        <h3 className="font-semibold text-red-200">Delete account</h3>
        <p className="mt-1 text-sm text-zinc-400">
          The account must be disabled and must not own worlds or durable records. Recomputes blockers at deletion time.
        </p>
        <button
          type="button"
          onClick={() => void loadPreview()}
          className="mt-3 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
        >
          Preview deletion blockers
        </button>
        {preview && (
          <div className="mt-3 space-y-2 text-sm">
            <p>Allowed: {preview.allowed ? "Yes" : "No"}</p>
            {preview.worlds.length > 0 && (
              <p className="text-red-300">Owned worlds: {preview.worlds.map((world) => `${world.title} (${world.id})`).join(", ")}</p>
            )}
            {preview.revisionIds.length > 0 && <p className="text-red-300">Revisions: {preview.revisionIds.join(", ")}</p>}
            {preview.foundryImportIds.length > 0 && <p className="text-red-300">Foundry imports: {preview.foundryImportIds.join(", ")}</p>}
            {preview.pendingImportIds.length > 0 && <p className="text-red-300">Pending imports: {preview.pendingImportIds.join(", ")}</p>}
          </div>
        )}
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!window.confirm("Delete this account permanently?")) return;
            void mutate(`/api/admin/users/${id}`, {
              expectedVersion: account.accountVersion,
              confirmEmail,
              backupAcknowledged,
            }).then((ok) => {
              if (ok) router.push("/admin/users");
            });
          }}
        >
          <label className="text-sm font-medium text-zinc-200">
            Confirm current email
            <input
              value={confirmEmail}
              onChange={(event) => setConfirmEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={backupAcknowledged}
              onChange={(event) => setBackupAcknowledged(event.target.checked)}
            />
            I acknowledge the account data has been backed up.
          </label>
          <button
            type="submit"
            disabled={busy || !backupAcknowledged}
            className="w-fit rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
          >
            Delete account
          </button>
        </form>
      </section>
    </section>
  );
}
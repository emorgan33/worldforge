"use client";

import { useEffect, useRef, useState } from "react";

type AuditEntry = {
  id: string;
  actorIdSnapshot: string | null;
  targetIdSnapshot: string | null;
  action: string;
  outcome: string;
  reasonCode: string | null;
  details: Record<string, unknown>;
  actorType: string;
  createdAt: string;
};

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const requestSeq = useRef(0);

  const [targetDraft, setTargetDraft] = useState("");
  const [actionDraft, setActionDraft] = useState("");
  const [targetId, setTargetId] = useState("");
  const [action, setAction] = useState("");

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function load(cursor?: string | null, replace = true, filters = { targetId, action }) {
    const requestId = ++requestSeq.current;
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (filters.targetId.trim()) params.set("targetId", filters.targetId.trim());
    if (filters.action) params.set("action", filters.action);
    if (cursor) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/admin/audit?${params.toString()}`);
      let data: { entries?: AuditEntry[]; nextCursor?: string | null; error?: string } = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }
      if (requestId !== requestSeq.current) return;
      if (!response.ok) {
        setError(data.error || "Unable to load audit events.");
        return;
      }
      setEntries((previous) => (replace ? data.entries || [] : [...previous, ...(data.entries || [])]));
      setNextCursor(data.nextCursor ?? null);
    } catch {
      if (requestId !== requestSeq.current) return;
      setError("Unable to load audit events. Retry the request.");
    } finally {
      if (requestId === requestSeq.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTargetId(targetDraft);
    setAction(actionDraft);
    await load(null, true, { targetId: targetDraft, action: actionDraft });
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-amber-100">Installation audit</h2>
        <p className="mt-1 text-sm text-zinc-400">Sanitized, append-only records of account administration.</p>
      </div>

      <form
        className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 md:grid-cols-3"
        onSubmit={applyFilters}
      >
        <label className="text-sm font-medium text-zinc-200">
          Target account ID
          <input
            value={targetDraft}
            onChange={(event) => setTargetDraft(event.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
        </label>
        <label className="text-sm font-medium text-zinc-200">
          Action
          <input
            value={actionDraft}
            onChange={(event) => setActionDraft(event.target.value)}
            placeholder="ACCOUNT_CREATE"
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
        </label>
        <div className="flex items-end">
          <button type="submit" disabled={loading || loadingMore} className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
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
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/70 text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-zinc-800/70">
                <td className="px-3 py-2 whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2">{entry.actorIdSnapshot || "local operator"}</td>
                <td className="px-3 py-2">{entry.targetIdSnapshot || "—"}</td>
                <td className="px-3 py-2">{entry.action}</td>
                <td className="px-3 py-2">{entry.outcome}</td>
                <td className="px-3 py-2">{entry.reasonCode || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && <p className="text-sm text-zinc-400">Loading audit events…</p>}
      {!loading && entries.length === 0 && <p className="text-sm text-zinc-400">No audit events match these filters.</p>}
      {nextCursor && (
        <button
          type="button"
          disabled={loading || loadingMore}
          onClick={() => void load(nextCursor, false)}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}

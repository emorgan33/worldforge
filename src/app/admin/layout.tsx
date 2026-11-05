import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";

async function AdminAccess({ children }: { children: React.ReactNode }) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    if (auth.failure.status === 401) redirect("/login");
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-zinc-950 p-8 text-white">
        <h1 className="text-2xl font-bold text-amber-200">Administrator access required</h1>
        <p className="mt-3 text-zinc-300">Your account is signed in but does not have installation administration rights.</p>
        <Link href="/" className="mt-6 text-indigo-300 underline">Return to workspace</Link>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/90">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="Back to workspace" className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
              Workspace
            </Link>
            <div>
              <p className="text-xs uppercase tracking-widest text-zinc-500">WorldForge</p>
              <h1 className="text-lg font-semibold">Installation administration</h1>
            </div>
          </div>
          <nav aria-label="Administration" className="flex flex-wrap gap-2">
            <Link href="/admin/users" className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
              Users
            </Link>
            <Link href="/admin/audit" className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
              Audit
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<main className="min-h-screen bg-zinc-950 p-8 text-sm text-zinc-400">Checking administrator access…</main>}>
      <AdminAccess>{children}</AdminAccess>
    </Suspense>
  );
}

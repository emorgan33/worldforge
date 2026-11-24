import { requireRequestTime } from "@/lib/request-time";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { formatBuildLabel, parseBuildInfo, UNKNOWN_REVISION } from "@/lib/build-info";
import { currentTheme } from "@/lib/theme-server";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";

const buildInfo = parseBuildInfo();

async function AdminAccess({ children, theme }: { children: React.ReactNode; theme: import("@/lib/theme").ThemeId }) {
  await requireRequestTime();
  const auth = await requireAdmin();
  if (!auth.ok) {
    if (auth.failure.status === 401) redirect("/login");
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-app-canvas p-8 text-app-text">
        <h1 className="text-2xl font-bold text-primary-200">Administrator access required</h1>
        <p className="mt-3 text-app-text-dim">Your account is signed in but does not have installation administration rights.</p>
        <Link href="/" className="mt-6 text-secondary-300 underline">Return to workspace</Link>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-app-canvas text-app-text-strong">
      <header className="border-b border-app-border bg-app-surface/90">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="Back to workspace" className="rounded-lg border border-app-border-strong px-3 py-2 text-sm font-medium text-app-text hover:border-app-border-emphasis-strong hover:text-app-text-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300">
              Workspace
            </Link>
            <div>
              <p className="text-xs uppercase tracking-widest text-app-subtle">WorldForge</p>
              <h1 className="text-lg font-semibold">Installation administration</h1>
              <p
                className="mt-1 text-xs text-app-subtle"
                data-testid="running-build"
                title={buildInfo.revision === UNKNOWN_REVISION ? "Revision was not recorded at build time." : `Revision ${buildInfo.revision}`}
              >
                Running build <span className="font-mono text-app-text-dim">{formatBuildLabel(buildInfo)}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <nav aria-label="Administration" className="flex flex-wrap gap-2">
              <Link href="/admin/users" className="rounded-lg border border-app-border-strong px-3 py-2 text-sm font-medium text-app-text hover:border-app-border-emphasis-strong hover:text-app-text-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300">
                Users
              </Link>
              <Link href="/admin/audit" className="rounded-lg border border-app-border-strong px-3 py-2 text-sm font-medium text-app-text hover:border-app-border-emphasis-strong hover:text-app-text-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300">
                Audit
              </Link>
            </nav>
            <div className="mx-auto flex w-full max-w-md justify-end p-3">
              <ThemeSwitcher current={theme} />
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const theme = await currentTheme();
  return (
    <Suspense fallback={<main className="min-h-screen bg-app-canvas p-8 text-sm text-app-muted">Checking administrator access…</main>}>
      <AdminAccess theme={theme}>{children}</AdminAccess>
    </Suspense>
  );
}

import { redirect } from "next/navigation";
import { requirePageAdmin } from "@/lib/admin-auth";
import AdminUserDetail from "@/components/admin/AdminUserDetail";

// The page reads the admin session before rendering; allow it to block on the
// request instead of failing Instant Navigation validation.
export const instant = false;

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePageAdmin();
  if (!auth.ok) {
    if (auth.failure.status === 401) redirect("/login");
    return null;
  }
  const { id } = await params;
  return <AdminUserDetail id={id} currentUserId={auth.actor.userId ?? null} />;
}

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import AdminUserDetail from "@/components/admin/AdminUserDetail";

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    if (auth.failure.status === 401) redirect("/login");
    return null;
  }
  const { id } = await params;
  return <AdminUserDetail id={id} currentUserId={auth.actor.userId ?? null} />;
}

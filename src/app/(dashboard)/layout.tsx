import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { getSessionUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar />
      <main className="pt-14 md:pl-64 md:pt-0">
        <div className="p-4 md:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}

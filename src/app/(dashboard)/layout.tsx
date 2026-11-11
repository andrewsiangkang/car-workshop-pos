import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { getCurrentUser } from "@/lib/auth";
import { UserProvider } from "@/components/layout/UserProvider";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <UserProvider user={{ name: user.name, role: user.role }}>
      <div className="min-h-screen bg-slate-50">
        <Sidebar />
        <main className="pt-14 md:pl-64 md:pt-0">
          <div className="p-4 md:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </UserProvider>
  );
}

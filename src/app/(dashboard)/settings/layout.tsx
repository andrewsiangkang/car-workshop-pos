import { redirect } from "next/navigation";
import { getCurrentUser, isOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Settings hold bank details, e-Invoice secrets, backups and staff accounts: boss only.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  if (!isOwner(await getCurrentUser())) redirect("/dashboard");
  return <>{children}</>;
}

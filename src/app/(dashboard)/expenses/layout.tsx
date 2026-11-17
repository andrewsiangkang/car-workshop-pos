import { redirect } from "next/navigation";
import { getCurrentUser, isOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

// 【中文】营业开支涉及资金，仅老板可见（页面本身也会再检查一次）。
export default async function OwnerOnlyLayout({ children }: { children: React.ReactNode }) {
  if (!isOwner(await getCurrentUser())) redirect("/dashboard");
  return <>{children}</>;
}

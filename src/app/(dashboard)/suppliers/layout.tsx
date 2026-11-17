import { redirect } from "next/navigation";
import { getCurrentUser, isOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

// 【中文】进货、供应商、付款凭证涉及成本和资金，仅老板可见。
export default async function OwnerOnlyLayout({ children }: { children: React.ReactNode }) {
  if (!isOwner(await getCurrentUser())) redirect("/dashboard");
  return <>{children}</>;
}

import { ApprovalClient } from "./ApprovalClient";
export const dynamic = "force-dynamic";
export default async function CustomerApprovalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> }) {
  const { id } = await params; const { token = "" } = await searchParams;
  return <div className="min-h-screen bg-slate-50"><ApprovalClient id={id} token={token}/></div>;
}

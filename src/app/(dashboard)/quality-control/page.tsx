import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/utils";
import { QCEditor } from "./QCEditor";
export const dynamic = "force-dynamic";
export default async function QualityControlPage() {
  await requirePageUser();
  const rows = await prisma.qCInspection.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { workOrder: { select: { id: true, orderNumber: true, vehicle: { select: { plateNumber: true } }, customer: { select: { name: true } } } }, items: true } });
  return <div className="space-y-5"><Header title="Quality Control" description="Final checks, road-test records and pass/fail history for workshop jobs." /><div className="overflow-hidden rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Work Order</th><th className="p-3">Vehicle</th><th className="p-3">Checklist</th><th className="p-3">Road Test</th><th className="p-3">Status</th><th className="p-3">Created</th></tr></thead><tbody className="divide-y">{rows.map((r) => <tr key={r.id}><td className="p-3"><Link href={`/work-orders/${r.workOrder.id}`} className="text-blue-700 hover:underline">{r.workOrder.orderNumber}</Link></td><td className="p-3">{r.workOrder.vehicle.plateNumber}<div className="text-xs text-slate-500">{r.workOrder.customer.name}</div></td><td className="p-3">{r.items.filter((x) => x.result === "PASS" || x.result === "NA").length}/{r.items.length} complete</td><td className="p-3">{r.roadTestDone ? "Done" : "—"}</td><td className="p-3"><div>{r.status}</div><div className="mt-2 min-w-[260px]"><QCEditor workOrderId={r.workOrder.id} qcInspectionId={r.id} items={r.items} status={r.status} roadTestDone={r.roadTestDone}/></div></td><td className="p-3">{formatDateTime(r.createdAt)}</td></tr>)}{rows.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400">No QC records yet</td></tr>}</tbody></table></div></div>;
}

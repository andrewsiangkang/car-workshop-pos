import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/utils";
import { ensureWorkshopDefaults } from "@/lib/workshop-defaults";
import { InspectionEditor } from "./InspectionEditor";
export const dynamic = "force-dynamic";
export default async function InspectionsPage() {
  await requirePageUser();
  await ensureWorkshopDefaults();
  const rows = await prisma.vehicleInspection.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { workOrder: { select: { id: true, orderNumber: true, customer: { select: { name: true } }, vehicle: { select: { plateNumber: true } } } }, findings: { include: { photos: true }, orderBy: { sortOrder: "asc" } } } });
  return <div className="space-y-5"><Header title="Digital Vehicle Inspections" description="Inspection records, findings and recommendations attached to existing work orders." /><div className="overflow-hidden rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Inspection</th><th className="p-3">Work Order / Vehicle</th><th className="p-3">Findings</th><th className="p-3">Created</th><th className="p-3">Status</th></tr></thead><tbody className="divide-y">{rows.map((r) => <tr key={r.id}><td className="p-3 font-medium">{r.inspectionNo}</td><td className="p-3"><Link className="text-blue-700 hover:underline" href={`/work-orders/${r.workOrder.id}`}>{r.workOrder.orderNumber}</Link><div className="text-xs text-slate-500">{r.workOrder.vehicle.plateNumber} · {r.workOrder.customer.name}</div></td><td className="p-3">{r.findings.length}</td><td className="p-3">{formatDateTime(r.createdAt)}</td><td className="p-3">{r.status}<div className="mt-2"><InspectionEditor inspectionId={r.id} findings={r.findings.map((f) => ({ ...f, photos: f.photos }))} status={r.status}/></div></td></tr>)}{rows.length === 0 && <tr><td colSpan={5} className="p-10 text-center text-slate-400">No inspections yet. Create one from a work order detail page.</td></tr>}</tbody></table></div></div>;
}

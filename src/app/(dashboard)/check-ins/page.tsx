import { Header } from "@/components/layout/Header";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/utils";
import { CheckInForm } from "./CheckInForm";
export const dynamic = "force-dynamic";
export default async function CheckInsPage() {
  await requirePageUser();
  const [vehicles, rows] = await Promise.all([
    prisma.vehicle.findMany({ orderBy: { plateNumber: "asc" }, take: 1000, include: { customer: { select: { name: true } } } }),
    prisma.vehicleCheckIn.findMany({ orderBy: { checkedInAt: "desc" }, take: 150, include: { vehicle: { select: { plateNumber: true, make: true, model: true } }, customer: { select: { name: true } }, photos: true } }),
  ]);
  return <div className="space-y-6"><Header title="Vehicle Check-in" description="Record odometer, fuel level, vehicle condition and items received before repair."/><div className="grid gap-5 xl:grid-cols-[380px_1fr]"><CheckInForm vehicles={vehicles.map((v) => ({ id: v.id, customerId: v.customerId, plateNumber: v.plateNumber, make: v.make, model: v.model, customerName: v.customer.name }))}/><section className="overflow-hidden rounded-xl border bg-white"><div className="border-b p-4 font-semibold">Recent Check-ins</div><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Check-in</th><th className="p-3">Vehicle / Customer</th><th className="p-3">Mileage</th><th className="p-3">Fuel</th><th className="p-3">Photos</th><th className="p-3">Date</th></tr></thead><tbody className="divide-y">{rows.map((r) => <tr key={r.id}><td className="p-3 font-medium">{r.checkInNo}</td><td className="p-3">{r.vehicle.plateNumber}<div className="text-xs text-slate-500">{r.customer.name}</div></td><td className="p-3">{r.mileageIn?.toLocaleString() ?? "—"}</td><td className="p-3">{r.fuelLevel || "—"}</td><td className="p-3">{r.photos.length}</td><td className="p-3">{formatDateTime(r.checkedInAt)}</td></tr>)}{rows.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400">No vehicle check-ins yet</td></tr>}</tbody></table></section></div><p className="text-xs text-slate-500">Photos are stored in the local workshop data folder via the authenticated workshop photo endpoint. Keep that folder in the backup and restore set.</p></div>;
}

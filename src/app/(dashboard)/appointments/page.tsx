import { Header } from "@/components/layout/Header";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/auth";
import { AppointmentForm } from "./AppointmentForm";
import { formatDateTime } from "@/lib/utils";
import { AppointmentStatus } from "./AppointmentStatus";
import { AppointmentCalendar } from "./AppointmentCalendar";
import { ensureWorkshopDefaults } from "@/lib/workshop-defaults";
export const dynamic = "force-dynamic";
export default async function AppointmentsPage() {
  await requirePageUser();
  await ensureWorkshopDefaults();
  const [customers, vehicles, technicians, bays, appointments] = await Promise.all([
    prisma.customer.findMany({ where: { anonymisedAt: null }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true, phone: true } }),
    prisma.vehicle.findMany({ orderBy: { plateNumber: "asc" }, take: 1000, select: { id: true, customerId: true, plateNumber: true, make: true, model: true } }),
    prisma.user.findMany({ where: { role: "TECHNICIAN", disabledAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.serviceBay.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.appointment.findMany({ orderBy: { startAt: "desc" }, take: 100, include: { customer: { select: { name: true } }, vehicle: { select: { plateNumber: true, make: true, model: true } }, assignedTechnician: { select: { name: true } }, serviceBay: { select: { name: true } } } }),
  ]);
  const calendarRows = appointments.map((a) => ({ id: a.id, appointmentNo: a.appointmentNo, startAt: a.startAt.toISOString(), endAt: a.endAt.toISOString(), status: a.status, serviceType: a.serviceType, customer: a.customer, vehicle: a.vehicle, assignedTechnician: a.assignedTechnician, serviceBay: a.serviceBay }));
  return <div className="space-y-6"><Header title="Appointments" description="Schedule workshop visits locally, with technician and service-bay conflict checks." />
    <AppointmentCalendar appointments={calendarRows} />
    <div className="grid gap-5 xl:grid-cols-[380px_1fr]"><AppointmentForm customers={customers.map((x) => ({ id: x.id, label: `${x.name} · ${x.phone}` }))} vehicles={vehicles.map((x) => ({ id: x.id, customerId: x.customerId, label: `${x.plateNumber} · ${x.make} ${x.model}` }))} technicians={technicians.map((x) => ({ id: x.id, label: x.name }))} bays={bays.map((x) => ({ id: x.id, label: x.name }))} />
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b p-4 font-semibold">Recent Appointments</div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Appointment</th><th className="p-3">Vehicle / Customer</th><th className="p-3">Schedule</th><th className="p-3">Assigned</th><th className="p-3">Status</th></tr></thead><tbody className="divide-y">{appointments.map((a) => <tr key={a.id}><td className="p-3 font-medium">{a.appointmentNo}</td><td className="p-3"><div>{a.vehicle.plateNumber}</div><div className="text-xs text-slate-500">{a.customer.name}</div></td><td className="p-3">{formatDateTime(a.startAt)}<div className="text-xs text-slate-500">to {formatDateTime(a.endAt)}</div></td><td className="p-3">{a.assignedTechnician?.name || "—"}<div className="text-xs text-slate-500">{a.serviceBay?.name || "No bay"}</div></td><td className="p-3"><AppointmentStatus id={a.id} status={a.status}/></td></tr>)}{appointments.length === 0 && <tr><td colSpan={5} className="p-10 text-center text-slate-400">No appointments yet</td></tr>}</tbody></table></div></section></div>
    <p className="text-xs text-slate-500">Customer and vehicle records must already exist. To create a new work order from an appointment, use the existing Work Orders workflow; automatic conversion is not enabled in this release.</p>
  </div>;
}

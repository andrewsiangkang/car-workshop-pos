"use client";
import { useState } from "react";

type Option = { id: string; label: string };
export function AppointmentForm({ customers, vehicles, technicians, bays }: { customers: Option[]; vehicles: (Option & { customerId: string })[]; technicians: Option[]; bays: Option[] }) {
  const [customerId, setCustomerId] = useState(customers[0]?.id || "");
  const [vehicleId, setVehicleId] = useState(vehicles.find((v) => v.customerId === customers[0]?.id)?.id || "");
  const [startAt, setStartAt] = useState(""); const [endAt, setEndAt] = useState("");
  const [serviceType, setServiceType] = useState("General Service"); const [technicianId, setTechnicianId] = useState(""); const [bayId, setBayId] = useState("");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const customerVehicles = vehicles.filter((v) => v.customerId === customerId);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMessage("");
    try {
      const res = await fetch("/api/appointments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId, vehicleId, startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString(), serviceType, assignedTechnicianId: technicianId || null, serviceBayId: bayId || null }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "Unable to save appointment");
      setMessage(`Appointment ${data.appointmentNo} created successfully.`); window.location.reload();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to save appointment"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
    <h2 className="font-semibold text-slate-900">New Appointment</h2>
    <label className="block text-sm">Customer<select required value={customerId} onChange={(e) => { setCustomerId(e.target.value); setVehicleId(vehicles.find((v) => v.customerId === e.target.value)?.id || ""); }} className="mt-1 w-full rounded-lg border p-2.5">{customers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
    <label className="block text-sm">Vehicle<select required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5">{customerVehicles.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
    <label className="block text-sm">Service<input value={serviceType} onChange={(e) => setServiceType(e.target.value)} maxLength={120} className="mt-1 w-full rounded-lg border p-2.5" /></label>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="block text-sm">Start<input required type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5" /></label><label className="block text-sm">End<input required type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5" /></label></div>
    <label className="block text-sm">Technician (optional)<select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5"><option value="">Unassigned</option>{technicians.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
    <label className="block text-sm">Service Bay (optional)<select value={bayId} onChange={(e) => setBayId(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5"><option value="">Not assigned</option>{bays.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
    {message && <p className="text-sm text-amber-700">{message}</p>}
    <button disabled={busy || !customerId || !vehicleId} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Create Appointment"}</button>
  </form>;
}

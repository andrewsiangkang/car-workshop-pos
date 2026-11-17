"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type InventoryOption = { id: string; label: string; quantityOnHand: number };
type Issue = { movementType: "ISSUE" | "RETURN"; quantity: number };
type Reservation = { id: string; quantity: number; status: string; notes: string | null; inventoryItem: { id: string; name: string; sku: string | null; unit: string }; issues: Issue[] };

export function WorkOrderPartsPanel({ workOrderId, inventory }: { workOrderId: string; inventory: InventoryOption[] }) {
  const [itemId, setItemId] = useState(inventory[0]?.id || "");
  const [quantity, setQuantity] = useState("1");
  const [rows, setRows] = useState<Reservation[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/work-orders/${workOrderId}/parts`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load parts");
    setRows(Array.isArray(data) ? data : []);
  }, [workOrderId]);

  useEffect(() => { refresh().catch((e) => setError(e instanceof Error ? e.message : "Unable to load parts")); }, [refresh]);

  async function act(action: string, reservation?: Reservation, amount?: number) {
    setBusy(reservation?.id || action); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/work-orders/${workOrderId}/parts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, inventoryItemId: reservation?.inventoryItem.id || itemId, reservationId: reservation?.id, quantity: amount ?? Number(quantity), idempotencyKey: action === "issue" || action === "return" ? crypto.randomUUID() : undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update parts");
      setMessage(action === "reserve" ? "Part reserved. Stock is not deducted until it is issued." : `Part ${action} completed.`);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update parts"); }
    finally { setBusy(""); }
  }

  const activeInventory = useMemo(() => inventory.filter((x) => x.quantityOnHand > 0), [inventory]);
  return <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
    <div><h3 className="font-semibold text-sm text-slate-900">Parts Reservation & Issue</h3><p className="text-xs text-slate-500">Reserve stock for this job; inventory is deducted only when issued. Returns are capped at the issued quantity.</p></div>
    <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
      <label className="min-w-[220px] flex-1 text-xs">Inventory item<select value={itemId} onChange={(e) => setItemId(e.target.value)} className="mt-1 w-full rounded border p-2 text-sm">{activeInventory.map((x) => <option key={x.id} value={x.id}>{x.label} · On hand {x.quantityOnHand}</option>)}</select></label>
      <label className="w-24 text-xs">Quantity<input type="number" min="0.001" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="mt-1 w-full rounded border p-2 text-sm" /></label>
      <button disabled={!!busy || !itemId || !(Number(quantity) > 0)} onClick={() => act("reserve")} className="rounded bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Reserve</button>
    </div>
    <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-2">Part</th><th className="p-2">Reserved</th><th className="p-2">Issued</th><th className="p-2">Returned</th><th className="p-2">Status</th><th className="p-2">Actions</th></tr></thead><tbody className="divide-y">{rows.map((row) => {
      const issued = row.issues.filter((x) => x.movementType === "ISSUE").reduce((sum, x) => sum + x.quantity, 0);
      const returned = row.issues.filter((x) => x.movementType === "RETURN").reduce((sum, x) => sum + x.quantity, 0);
      const outstanding = Math.max(0, issued - returned);
      return <tr key={row.id}><td className="p-2 font-medium">{row.inventoryItem.name}<div className="text-slate-400">{row.inventoryItem.sku || "—"}</div></td><td className="p-2">{row.quantity}</td><td className="p-2">{issued}</td><td className="p-2">{returned}</td><td className="p-2">{row.status}</td><td className="p-2"><div className="flex flex-wrap gap-1">{row.status === "RESERVED" && <><button disabled={!!busy} onClick={() => act("issue", row, row.quantity)} className="rounded bg-blue-700 px-2 py-1 text-white disabled:opacity-50">Issue</button><button disabled={!!busy} onClick={() => act("release", row, row.quantity)} className="rounded border px-2 py-1 disabled:opacity-50">Release</button></>}{row.status === "ISSUED" && outstanding > 0 && <button disabled={!!busy} onClick={() => act("return", row, outstanding)} className="rounded border px-2 py-1 disabled:opacity-50">Return {outstanding}</button>}</div></td></tr>;
    })}{rows.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">No parts reserved for this work order.</td></tr>}</tbody></table></div>
    {message && <p className="text-xs text-emerald-700">{message}</p>}{error && <p className="text-xs text-red-700">{error}</p>}
  </section>;
}

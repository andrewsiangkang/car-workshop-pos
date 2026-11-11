"use client";

import { Header } from "@/components/layout/Header";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ArrowRight, Search } from "lucide-react";

type LineItem = {
  id: string;
  type: "PART" | "LABOR";
  description: string;
  quantity: number;
  unitPrice: number;
  costPrice?: number;
  inventoryItemId?: string | null;
};

type InvItem = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  quantityOnHand: number;
  sellingPrice: number;
  costPrice: number;
};

const emptyItem = (): LineItem => ({
  id: Math.random().toString(36).slice(2),
  type: "PART",
  description: "",
  quantity: 1,
  unitPrice: 0,
});

export default function NewWorkOrderPage() {
  const router = useRouter();
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [mileage, setMileage] = useState("");
  const [description, setDescription] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [items, setItems] = useState<LineItem[]>([emptyItem()]);
  const [discount, setDiscount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [lookupHint, setLookupHint] = useState("");

  const [invList, setInvList] = useState<InvItem[]>([]);
  const [invSearch, setInvSearch] = useState("");
  const [showInvFor, setShowInvFor] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/inventory")
      .then((r) => r.json())
      .then((d) => setInvList(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  async function lookupPlate(p: string) {
    const clean = p.trim().toUpperCase();
    if (clean.length < 2) {
      setLookupHint("");
      return;
    }
    try {
      const res = await fetch(`/api/vehicles/lookup?plate=${encodeURIComponent(clean)}`);
      const data = await res.json();
      if (data.found) {
        setMake(data.vehicle.make || "");
        setModel(data.vehicle.model || "");
        setCustomerName(data.customer?.name || "");
        setPhone(data.customer?.phone || "");
        if (data.vehicle.mileage) setMileage(String(data.vehicle.mileage));
        setLookupHint(`Found existing vehicle: ${data.vehicle.make} ${data.vehicle.model}`);
      } else {
        setLookupHint("New vehicle — please fill make & model");
      }
    } catch {
      setLookupHint("");
    }
  }

  function updateItem(id: string, field: keyof LineItem, value: string | number) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(id: string) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.id !== id)));
  }

  function pickInventory(lineId: string, inv: InvItem) {
    setItems((prev) =>
      prev.map((it) =>
        it.id === lineId
          ? {
              ...it,
              type: "PART",
              description: inv.name,
              unitPrice: inv.sellingPrice,
              costPrice: inv.costPrice,
              inventoryItemId: inv.id,
            }
          : it
      )
    );
    setShowInvFor(null);
    setInvSearch("");
  }

  const partsAmount = items.filter((i) => i.type === "PART").reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const laborAmount = items.filter((i) => i.type === "LABOR").reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const totalAmount = Math.max(0, partsAmount + laborAmount - discount);

  const filteredInv = invList.filter(
    (i) =>
      !invSearch ||
      i.name.toLowerCase().includes(invSearch.toLowerCase()) ||
      (i.sku || "").toLowerCase().includes(invSearch.toLowerCase())
  );

  async function handleCreateQuotation() {
    setError("");
    if (!plate.trim()) {
      setError("Please fill in plate number");
      return;
    }
    const validItems = items.filter((i) => i.description.trim());
    if (validItems.length === 0) {
      setError("Please add at least one line item");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plate: plate.trim().toUpperCase(),
          make: make.trim() || "Unknown",
          model: model.trim() || "Unknown",
          customerName: customerName.trim(),
          phone: phone.trim(),
          mileage,
          description,
          diagnosis,
          discount,
          items: validItems.map((i) => ({
            type: i.type,
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            costPrice: i.costPrice || 0,
            inventoryItemId: i.inventoryItemId || null,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create");
        setSaving(false);
        return;
      }
      router.push(`/work-orders/${data.id}/quotation`);
    } catch {
      setError("Save failed, please retry");
      setSaving(false);
    }
  }

  return (
    <div>
      <Header
        title="New Work Order"
        description="Fill in details → Add items → Generate quotation"
        actions={
          <Link
            href="/work-orders"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to List
          </Link>
        }
      />

      <div className="space-y-6">
        {/* Vehicle & Customer */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Vehicle & Customer</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Plate Number *</label>
              <input
                type="text"
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                onBlur={() => lookupPlate(plate)}
                placeholder="ABC1234"
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm uppercase outline-none focus:border-blue-500"
              />
              {lookupHint && <p className="mt-1 text-xs text-blue-600">{lookupHint}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Make (Brand)</label>
              <input
                type="text"
                value={make}
                onChange={(e) => setMake(e.target.value)}
                placeholder="Toyota, Honda, Proton..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Model</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Vios, Civic, Saga..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Customer Name</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Optional for now"
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Phone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Current Mileage (km)</label>
              <input
                type="number"
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Complaint */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Complaint</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Customer Complaint</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. engine noise, oil change..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Diagnosis / Notes</label>
              <textarea
                rows={2}
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Items</h2>
            <button
              type="button"
              onClick={addItem}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" /> Add Item
            </button>
          </div>

          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="relative flex flex-wrap items-start gap-2 rounded-lg border border-slate-100 p-3">
                <select
                  value={item.type}
                  onChange={(e) => updateItem(item.id, "type", e.target.value)}
                  className="rounded border border-slate-200 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="PART">Part</option>
                  <option value="LABOR">Labor</option>
                </select>

                <div className="relative min-w-[200px] flex-1">
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => updateItem(item.id, "description", e.target.value)}
                    placeholder={item.type === "PART" ? "Description or select from inventory..." : "Labor description"}
                    className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                  />
                  {item.type === "PART" && (
                    <button
                      type="button"
                      onClick={() => setShowInvFor(showInvFor === item.id ? null : item.id)}
                      className="absolute right-1 top-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600"
                      title="Select from inventory"
                    >
                      <Search className="h-4 w-4" />
                    </button>
                  )}
                  {showInvFor === item.id && (
                    <div className="absolute left-0 top-full z-20 mt-1 w-80 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                      <input
                        autoFocus
                        value={invSearch}
                        onChange={(e) => setInvSearch(e.target.value)}
                        placeholder="Search inventory..."
                        className="mb-2 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                      />
                      <div className="max-h-48 overflow-y-auto">
                        {filteredInv.length === 0 && (
                          <div className="px-2 py-3 text-center text-xs text-slate-400">No items</div>
                        )}
                        {filteredInv.map((inv) => (
                          <button
                            key={inv.id}
                            type="button"
                            onClick={() => pickInventory(item.id, inv)}
                            className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                          >
                            <span>
                              {inv.name}
                              {inv.sku && <span className="ml-1 text-xs text-slate-400">({inv.sku})</span>}
                            </span>
                            <span className="text-xs text-slate-500">
                              {inv.quantityOnHand} · RM {inv.sellingPrice.toFixed(2)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={item.quantity}
                  onChange={(e) => updateItem(item.id, "quantity", parseFloat(e.target.value) || 0)}
                  className="w-20 rounded border border-slate-200 px-2 py-1.5 text-sm text-right outline-none"
                />
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={item.unitPrice}
                  onChange={(e) => updateItem(item.id, "unitPrice", parseFloat(e.target.value) || 0)}
                  className="w-24 rounded border border-slate-200 px-2 py-1.5 text-sm text-right outline-none"
                />
                <div className="w-24 text-right text-sm font-medium">
                  RM {(item.quantity * item.unitPrice).toFixed(2)}
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                {item.inventoryItemId && (
                  <div className="w-full text-xs text-emerald-600">Linked to inventory (stock will be deducted)</div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <div className="w-56 space-y-1 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Parts Subtotal</span>
                <span>RM {partsAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Labor Subtotal</span>
                <span>RM {laborAmount.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span>Discount</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={discount}
                  onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                  className="w-24 rounded border border-slate-200 px-2 py-1 text-right text-sm outline-none"
                />
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
                <span>Total</span>
                <span>RM {totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleCreateQuotation}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Generate Quotation"}
            {!saving && <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

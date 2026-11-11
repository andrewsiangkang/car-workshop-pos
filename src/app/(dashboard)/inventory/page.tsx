"use client";

import { Header } from "@/components/layout/Header";
import { useEffect, useState } from "react";
import { Plus, Search, Package, AlertTriangle, Edit2, Trash2, ArrowUpDown } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type Item = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  quantityOnHand: number;
  costPrice: number;
  sellingPrice: number;
  minStockLevel: number;
  notes: string | null;
};

const emptyForm = {
  name: "",
  sku: "",
  category: "",
  unit: "pcs",
  quantityOnHand: 0,
  costPrice: 0,
  sellingPrice: 0,
  minStockLevel: 0,
  notes: "",
};

export default function InventoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [adjustItem, setAdjustItem] = useState<Item | null>(null);
  const [adjType, setAdjType] = useState<"IN" | "OUT" | "ADJUST">("IN");
  const [adjQty, setAdjQty] = useState("");
  const [adjNotes, setAdjNotes] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/inventory?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setItems(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setShowForm(true);
  }

  function openEdit(item: Item) {
    setEditing(item);
    setForm({
      name: item.name,
      sku: item.sku || "",
      category: item.category || "",
      unit: item.unit,
      quantityOnHand: item.quantityOnHand,
      costPrice: item.costPrice,
      sellingPrice: item.sellingPrice,
      minStockLevel: item.minStockLevel,
      notes: item.notes || "",
    });
    setError("");
    setShowForm(true);
  }

  async function save() {
    setError("");
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    try {
      const url = editing ? `/api/inventory/${editing.id}` : "/api/inventory";
      const method = editing ? "PATCH" : "POST";
      const body = editing
        ? { ...form, quantityOnHand: undefined } // don't overwrite qty on edit
        : form;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Save failed");
        setSaving(false);
        return;
      }
      setShowForm(false);
      await load();
    } catch {
      setError("Save failed");
    }
    setSaving(false);
  }

  async function remove(id: string) {
    if (!confirm("Delete this inventory item?")) return;
    await fetch(`/api/inventory/${id}`, { method: "DELETE" });
    await load();
  }

  async function doAdjust() {
    if (!adjustItem) return;
    const qty = parseFloat(adjQty);
    if (!qty || isNaN(qty)) {
      alert("Enter a valid quantity");
      return;
    }
    const res = await fetch(`/api/inventory/${adjustItem.id}/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: adjType, quantity: qty, notes: adjNotes }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Adjustment failed");
      return;
    }
    setAdjustItem(null);
    setAdjQty("");
    setAdjNotes("");
    await load();
  }

  const lowCount = items.filter((i) => i.quantityOnHand <= i.minStockLevel).length;

  return (
    <div>
      <Header
        title="Inventory"
        description="Spare parts & materials stock"
        actions={
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800"
          >
            <Plus className="h-4 w-4" />
            Add Item
          </button>
        }
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
          className="relative max-w-md flex-1"
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, SKU, category..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </form>
        {lowCount > 0 && (
          <div className="inline-flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            {lowCount} low stock item{lowCount > 1 ? "s" : ""}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Item</th>
              <th className="px-5 py-3 font-medium">SKU</th>
              <th className="px-5 py-3 font-medium">Category</th>
              <th className="px-5 py-3 text-right font-medium">Stock</th>
              <th className="px-5 py-3 text-right font-medium">Cost</th>
              <th className="px-5 py-3 text-right font-medium">Price</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                  No inventory items yet
                </td>
              </tr>
            )}
            {items.map((item) => {
              const low = item.quantityOnHand <= item.minStockLevel;
              return (
                <tr key={item.id} className={low ? "bg-amber-50/50" : "hover:bg-slate-50"}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
                        <Package className="h-4 w-4 text-slate-500" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{item.name}</div>
                        {item.notes && <div className="text-xs text-slate-500">{item.notes}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">{item.sku || "-"}</td>
                  <td className="px-5 py-3.5 text-slate-600">{item.category || "-"}</td>
                  <td className="px-5 py-3.5 text-right">
                    <span className={low ? "font-semibold text-amber-700" : "text-slate-700"}>
                      {item.quantityOnHand} {item.unit}
                    </span>
                    {low && (
                      <div className="text-xs text-amber-600">Low (min {item.minStockLevel})</div>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right text-slate-600">{formatCurrency(item.costPrice)}</td>
                  <td className="px-5 py-3.5 text-right text-slate-700">{formatCurrency(item.sellingPrice)}</td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => {
                          setAdjustItem(item);
                          setAdjType("IN");
                          setAdjQty("");
                          setAdjNotes("");
                        }}
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                        title="Adjust stock"
                      >
                        <ArrowUpDown className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => openEdit(item)}
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => remove(item.id)}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold">{editing ? "Edit Item" : "Add Inventory Item"}</h3>
            {error && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="mb-1 block text-sm font-medium">Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">SKU</label>
                <input
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Category</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Oil, Filter, Brake..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Unit</label>
                <input
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              {!editing && (
                <div>
                  <label className="mb-1 block text-sm font-medium">Initial Qty</label>
                  <input
                    type="number"
                    value={form.quantityOnHand}
                    onChange={(e) => setForm({ ...form, quantityOnHand: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium">Cost Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.costPrice}
                  onChange={(e) => setForm({ ...form, costPrice: parseFloat(e.target.value) || 0 })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Selling Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.sellingPrice}
                  onChange={(e) => setForm({ ...form, sellingPrice: parseFloat(e.target.value) || 0 })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Min Stock</label>
                <input
                  type="number"
                  value={form.minStockLevel}
                  onChange={(e) => setForm({ ...form, minStockLevel: parseFloat(e.target.value) || 0 })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-sm font-medium">Notes</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stock Adjust Modal */}
      {adjustItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-semibold">Adjust Stock</h3>
            <p className="mb-4 text-sm text-slate-500">{adjustItem.name} · current {adjustItem.quantityOnHand} {adjustItem.unit}</p>
            <div className="space-y-3">
              <div className="flex gap-2">
                {(["IN", "OUT", "ADJUST"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setAdjType(t)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                      adjType === t ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200"
                    }`}
                  >
                    {t === "IN" ? "Stock In" : t === "OUT" ? "Stock Out" : "Adjust"}
                  </button>
                ))}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Quantity</label>
                <input
                  type="number"
                  value={adjQty}
                  onChange={(e) => setAdjQty(e.target.value)}
                  placeholder={adjType === "ADJUST" ? "e.g. -2 or +5" : "e.g. 10"}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Notes</label>
                <input
                  value={adjNotes}
                  onChange={(e) => setAdjNotes(e.target.value)}
                  placeholder="Purchase, used, correction..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setAdjustItem(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">
                Cancel
              </button>
              <button onClick={doAdjust} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white">
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

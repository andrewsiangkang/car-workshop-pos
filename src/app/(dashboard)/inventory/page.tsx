"use client";

import { Header } from "@/components/layout/Header";
import { useEffect, useState } from "react";
import { Plus, Search, Package, AlertTriangle, Edit2, Archive, ArchiveRestore, ArrowUpDown } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useUser } from "@/components/layout/UserProvider";

type Item = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  quantityOnHand: number;
  costPrice?: number; // only present for the boss
  sellingPrice: number;
  minStockLevel: number;
  notes: string | null;
  archivedAt?: string | null; // set = archived ("deleted"): hidden by default, history kept
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
  const { isOwner } = useUser();
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // "Show archived" adds archived items (with a Restore button); the server's refusals are shown here.
  const [showArchived, setShowArchived] = useState(false);
  const [pageError, setPageError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [adjustItem, setAdjustItem] = useState<Item | null>(null);
  const [adjType, setAdjType] = useState<"IN" | "OUT" | "ADJUST">("IN");
  const [adjQty, setAdjQty] = useState("");
  const [adjNotes, setAdjNotes] = useState("");

  async function load(archived = showArchived) {
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory?q=${encodeURIComponent(q)}${archived ? "&archived=1" : ""}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setPageError("Failed to load inventory");
    }
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
      costPrice: item.costPrice ?? 0,
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

  // "Delete" archives the item: it disappears from lists and pickers, its stock history is kept.
  // The server refuses while stock is not 0 or quotations / jobs not yet invoiced use it: show why instead of failing silently.
  // 【中文】"删除"改为归档；服务器拒绝时（库存不是 0、或有报价单在用）显示原因，不会再默默失败。
  async function remove(item: Item) {
    if (!confirm("Archive this item? It is hidden from the list and the part pickers, and its stock history is kept. You can restore it later.")) return;
    setPageError("");
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/inventory/${item.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setPageError(data.error || "Failed to archive");
      else await load();
    } catch {
      setPageError("Failed to archive");
    }
    setBusyId(null);
  }

  async function restore(item: Item) {
    setPageError("");
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/inventory/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setPageError(data.error || "Failed to restore");
      else await load();
    } catch {
      setPageError("Failed to restore");
    }
    setBusyId(null);
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

  const lowCount = items.filter((i) => !i.archivedAt && i.quantityOnHand <= i.minStockLevel).length;

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
        <div className="flex flex-wrap items-center gap-3">
          {isOwner && (
            <label className="inline-flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => {
                  setShowArchived(e.target.checked);
                  load(e.target.checked);
                }}
              />
              <span>Show archived</span>
            </label>
          )}
          {lowCount > 0 && (
            <div className="inline-flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              <AlertTriangle className="h-4 w-4" />
              {lowCount} low stock item{lowCount > 1 ? "s" : ""}
            </div>
          )}
        </div>
      </div>

      {pageError && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{pageError}</span>
          <button onClick={() => setPageError("")} className="text-xs font-medium text-red-700 underline">
            Close
          </button>
        </div>
      )}

      {/* On a phone the table scrolls sideways inside its box, so the Actions column stays reachable. */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Item</th>
              <th className="px-5 py-3 font-medium">SKU</th>
              <th className="px-5 py-3 font-medium">Category</th>
              <th className="px-5 py-3 text-right font-medium">Stock</th>
              {isOwner && <th className="px-5 py-3 text-right font-medium">Cost</th>}
              <th className="px-5 py-3 text-right font-medium">Price</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={isOwner ? 7 : 6} className="px-5 py-10 text-center text-slate-400">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={isOwner ? 7 : 6} className="px-5 py-10 text-center text-slate-400">
                  No inventory items yet
                </td>
              </tr>
            )}
            {items.map((item) => {
              const archived = !!item.archivedAt;
              const low = !archived && item.quantityOnHand <= item.minStockLevel;
              return (
                <tr key={item.id} className={archived ? "bg-slate-50 text-slate-400" : low ? "bg-amber-50/50" : "hover:bg-slate-50"}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
                        <Package className="h-4 w-4 text-slate-500" />
                      </div>
                      <div>
                        <div className={archived ? "font-semibold text-slate-500" : "font-semibold text-slate-900"}>{item.name}</div>
                        {archived && (
                          <span className="mt-0.5 inline-block rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">Archived</span>
                        )}
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
                  {isOwner && (
                    <td className="px-5 py-3.5 text-right text-slate-600">{formatCurrency(item.costPrice ?? 0)}</td>
                  )}
                  <td className="px-5 py-3.5 text-right text-slate-700">{formatCurrency(item.sellingPrice)}</td>
                  <td className="px-5 py-3.5 text-right">
                    {archived ? (
                      <div className="flex justify-end">
                        {isOwner && (
                          <button
                            onClick={() => restore(item)}
                            disabled={busyId === item.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                            title="Restore"
                          >
                            <ArchiveRestore className="h-4 w-4" />
                            <span>Restore</span>
                          </button>
                        )}
                      </div>
                    ) : (
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
                        title="Edit"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      {isOwner && (
                        <button
                          onClick={() => remove(item)}
                          disabled={busyId === item.id}
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          title="Archive"
                        >
                          <Archive className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    )}
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
              {isOwner && (
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
              )}
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

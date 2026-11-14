"use client";

import { Header } from "@/components/layout/Header";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ArrowRight, Search } from "lucide-react";
import { computeTotals } from "@/lib/tax";
import { normalisePlate } from "@/lib/customer-match.mjs";
import { useUser } from "@/components/layout/UserProvider";
import { formatDateTime } from "@/lib/utils";
import {
  autosaveDraft,
  browserStorage,
  clearDraft,
  isDraftWorthKeeping,
  loadDraft,
  pruneDrafts,
  type DraftForm,
} from "@/lib/ux-workorder-draft.mjs";

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
  const { id: userId } = useUser();
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
  const [tax, setTax] = useState<{ rate: number; scope: string }>({ rate: 0, scope: "ALL" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // found: an existing car (make / model shown as typed, never translated); new: not on file yet.
  const [lookupHint, setLookupHint] = useState<{ kind: "found"; make: string; model: string } | { kind: "new" } | null>(null);
  // Set when the phone belongs to a customer saved under another name: ask before renaming.
  const [nameClash, setNameClash] = useState<{ currentName: string; typedName: string } | null>(null);

  const [invList, setInvList] = useState<InvItem[]>([]);
  const [invSearch, setInvSearch] = useState("");
  const [showInvFor, setShowInvFor] = useState<string | null>(null);

  // Draft kept in this browser (per user) so the idle logout does not lose a half-filled job.
  // 【中文】草稿：自动登出或关掉窗口后，下次打开可以恢复。
  const [draftReady, setDraftReady] = useState(false);
  const [draftOffer, setDraftOffer] = useState<{ savedAt: number; form: DraftForm } | null>(null);
  const [draftKept, setDraftKept] = useState(false);
  const created = useRef(false);

  useEffect(() => {
    const storage = browserStorage();
    pruneDrafts(storage, Date.now());
    setDraftOffer(loadDraft(storage, userId, Date.now()));
    setDraftReady(true);
  }, [userId]);

  const currentForm = () => ({ plate, make, model, customerName, phone, mileage, description, diagnosis, discount, items });

  // Save on every change. While the "Restore draft" offer is open the old draft stays stored until
  // something is typed; from then on what was typed is kept (see autosaveDraft).
  // 【中文】每次修改都保存；恢复提示还在时，开始输入后就改存新内容，不会丢掉刚输入的工单。
  useEffect(() => {
    if (!draftReady || created.current) return;
    const form = { plate, make, model, customerName, phone, mileage, description, diagnosis, discount, items };
    setDraftKept(autosaveDraft(browserStorage(), userId, form, Date.now(), draftOffer));
  }, [draftReady, draftOffer, userId, plate, make, model, customerName, phone, mileage, description, diagnosis, discount, items]);

  function restoreDraft() {
    if (!draftOffer) return;
    if (isDraftWorthKeeping(currentForm()) && !window.confirm("Replace what you typed with the saved draft?")) return;
    const f = draftOffer.form;
    setPlate(f.plate);
    setMake(f.make);
    setModel(f.model);
    setCustomerName(f.customerName);
    setPhone(f.phone);
    setMileage(f.mileage);
    setDescription(f.description);
    setDiagnosis(f.diagnosis);
    setDiscount(f.discount);
    // Cost prices are not kept in the draft: the server looks them up for parts linked to inventory.
    setItems(
      f.items.length
        ? f.items.map((i) => ({ ...emptyItem(), type: i.type, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, inventoryItemId: i.inventoryItemId }))
        : [emptyItem()]
    );
    setLookupHint(null);
    setDraftOffer(null);
  }

  function discardOfferedDraft() {
    // Only the offered draft goes: anything typed meanwhile stays saved by the autosave above.
    if (!isDraftWorthKeeping(currentForm())) clearDraft(browserStorage(), userId);
    setDraftOffer(null);
  }

  function discardCurrentDraft() {
    if (!window.confirm("Discard this draft? Everything typed on this page will be cleared.")) return;
    clearDraft(browserStorage(), userId);
    setPlate("");
    setMake("");
    setModel("");
    setCustomerName("");
    setPhone("");
    setMileage("");
    setDescription("");
    setDiagnosis("");
    setDiscount(0);
    setItems([emptyItem()]);
    setLookupHint(null);
    setNameClash(null);
    setError("");
  }

  useEffect(() => {
    fetch("/api/inventory")
      .then((r) => r.json())
      .then((d) => setInvList(Array.isArray(d) ? d : []))
      .catch(() => {});
    fetch("/api/shop/tax")
      .then((r) => r.json())
      .then((d) => { if (typeof d.rate === "number") setTax({ rate: d.rate, scope: d.scope }); })
      .catch(() => {});
  }, []);

  async function lookupPlate(p: string) {
    // Same rule as saving: spaces removed, upper case.
    const clean = normalisePlate(p);
    if (clean.length < 2) {
      setLookupHint(null);
      return;
    }
    try {
      const res = await fetch(`/api/vehicles/lookup?plate=${encodeURIComponent(clean)}`);
      const data = await res.json();
      if (data.found) {
        setMake(data.vehicle.make || "");
        setModel(data.vehicle.model || "");
        setCustomerName(data.customer?.name || "");
        // The server never sends a placeholder ("N/A") phone for a walk-in.
        setPhone(data.customer?.phone || "");
        if (data.vehicle.mileage) setMileage(String(data.vehicle.mileage));
        setLookupHint({ kind: "found", make: String(data.vehicle.make || ""), model: String(data.vehicle.model || "") });
      } else {
        setLookupHint({ kind: "new" });
      }
    } catch {
      setLookupHint(null);
    }
  }

  function updateItem(id: string, field: keyof LineItem, value: string | number) {
    setItems((prev) =>
      prev.map((it) =>
        it.id !== id
          ? it
          : field === "type" && value === "LABOR"
          ? // Labour never comes off the shelf: drop the inventory link (and its cost) so stock
            // is not silently skipped at invoicing. 【中文】改成工钱时取消库存关联。
            { ...it, type: "LABOR", inventoryItemId: undefined, costPrice: undefined }
          : { ...it, [field]: value }
      )
    );
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

  // Same calculation the server uses, so the preview matches the saved quote.
  const { partsAmount, laborAmount, taxAmount, totalAmount } = computeTotals(
    items.filter((i) => i.description.trim()).map((i) => ({ type: i.type, total: i.quantity * i.unitPrice })),
    discount,
    tax.rate,
    tax.scope
  );

  const filteredInv = invList.filter(
    (i) =>
      !invSearch ||
      i.name.toLowerCase().includes(invSearch.toLowerCase()) ||
      (i.sku || "").toLowerCase().includes(invSearch.toLowerCase())
  );

  // renameCustomer: undefined = not asked yet; true / false = the user's answer to the name clash.
  async function handleCreateQuotation(renameCustomer?: boolean) {
    setError("");
    setNameClash(null);
    if (!normalisePlate(plate)) {
      setError("Please fill in plate number");
      return;
    }
    const validItems = items.filter((i) => i.description.trim());
    if (validItems.length === 0) {
      setError("Please add at least one line item");
      return;
    }
    // Quantity 0 / blank is refused by the server too (it used to be charged as 1).
    if (validItems.some((i) => !(Number(i.quantity) > 0))) {
      setError("Every line needs a quantity greater than 0");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plate: normalisePlate(plate),
          // Blank make / model are sent blank: the server only uses "Unknown" for a new car,
          // so an existing car's make / model are never overwritten.
          make: make.trim(),
          model: model.trim(),
          customerName: customerName.trim(),
          renameCustomer,
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
      if (res.status === 409 && data.code === "CUSTOMER_NAME_DIFFERS") {
        setNameClash({ currentName: String(data.currentName || ""), typedName: String(data.typedName || "") });
        setSaving(false);
        return;
      }
      if (!res.ok) {
        setError(data.error || "Failed to create");
        setSaving(false);
        return;
      }
      created.current = true;
      clearDraft(browserStorage(), userId);
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
        {draftOffer && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
            <div className="font-semibold">An unsaved new work order was kept on this computer</div>
            <div className="mt-1 text-blue-900">
              <span>Last change:</span> <span data-no-i18n>{formatDateTime(new Date(draftOffer.savedAt))}</span>
              {draftOffer.form.plate && (
                <>
                  {" · "}
                  <span data-no-i18n>{draftOffer.form.plate}</span>
                </>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={restoreDraft}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
              >
                Restore draft
              </button>
              <button
                type="button"
                onClick={discardOfferedDraft}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Discard draft
              </button>
            </div>
          </div>
        )}

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
              {lookupHint?.kind === "found" && (
                <p className="mt-1 text-xs text-blue-600">
                  <span>Found existing vehicle:</span>{" "}
                  <span data-no-i18n>
                    {lookupHint.make} {lookupHint.model}
                  </span>
                </p>
              )}
              {lookupHint?.kind === "new" && <p className="mt-1 text-xs text-blue-600">New vehicle — please fill make & model</p>}
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
                  className={`w-20 rounded border px-2 py-1.5 text-sm text-right outline-none ${
                    item.description.trim() && !(item.quantity > 0) ? "border-red-400 bg-red-50" : "border-slate-200"
                  }`}
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
                  <div className="w-full text-xs text-emerald-600">Linked to inventory (stock is deducted when the invoice is issued)</div>
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
              {tax.rate > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>SST {tax.rate}%{tax.scope === "LABOR" ? " (labour)" : ""}</span>
                  <span>RM {taxAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
                <span>Total</span>
                <span>RM {totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {nameClash && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-semibold">This phone number belongs to an existing customer with a different name</div>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              <div>
                <span className="text-amber-700">Name on file:</span> <strong data-no-i18n>{nameClash.currentName}</strong>
              </div>
              <div>
                <span className="text-amber-700">Name typed:</span> <strong data-no-i18n>{nameClash.typedName}</strong>
              </div>
            </div>
            <p className="mt-2 text-xs text-amber-800">
              Renaming changes the name on this customer&apos;s record. Keep the existing name if this is the same person.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => handleCreateQuotation(false)}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
              >
                Keep existing name
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleCreateQuotation(true)}
                className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
              >
                Rename customer to the typed name
              </button>
              <button
                type="button"
                onClick={() => setNameClash(null)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          {draftKept && !draftOffer && (
            <div className="flex items-center justify-between gap-3 text-xs text-slate-500 sm:mr-auto sm:justify-start">
              <span>Draft kept on this computer until the work order is saved.</span>
              <button type="button" onClick={discardCurrentDraft} className="rounded px-2 py-1 text-red-600 hover:bg-red-50">
                Discard draft
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => handleCreateQuotation()}
            disabled={saving || !!nameClash}
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

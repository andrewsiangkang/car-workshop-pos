"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanLine, Plus, Trash2 } from "lucide-react";
import { parseInvoiceText } from "@/lib/supplier-parse";
import { recognizeImage, shrinkImage } from "@/lib/ocr-client";
import { formatCurrency } from "@/lib/utils";

type Row = { description: string; category: string; quantity: string; unitCost: string; sellingPrice: string };

const CATEGORIES = [
  "Oil & Lubricants", "Filters", "Brakes", "Tyres & Wheels", "Battery", "Ignition", "Suspension & Steering",
  "Engine & Cooling", "Electrical", "Air Conditioning", "Body & Exterior", "Labour / Service", "Others",
];
const input =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const emptyRow = (): Row => ({ description: "", category: "Others", quantity: "1", unitCost: "", sellingPrice: "" });
const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

export function NewSupplierInvoice() {
  const router = useRouter();
  const [supplierName, setSupplierName] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [imageUrl, setImageUrl] = useState("");
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scanNote, setScanNote] = useState("");
  const [scannedTotal, setScannedTotal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/suppliers")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Array<{ name: string }>) => setSuppliers(list.map((s) => s.name)))
      .catch(() => {});
  }, []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setScanNote("");
    setScanning(true);
    setProgress(0);
    try {
      // 保存发票照片副本（失败不影响扫描）
      shrinkImage(file).then(async (blob) => {
        if (!blob) return;
        const fd = new FormData();
        fd.append("file", new File([blob], "invoice.jpg", { type: "image/jpeg" }));
        const r = await fetch("/api/upload", { method: "POST", body: fd });
        if (r.ok) setImageUrl((await r.json()).url);
      }).catch(() => {});

      const text = await recognizeImage(file, setProgress);
      const p = parseInvoiceText(text);
      if (p.supplierName) setSupplierName(p.supplierName);
      if (p.invoiceNo) setInvoiceNo(p.invoiceNo);
      if (p.invoiceDate) setInvoiceDate(p.invoiceDate);
      if (p.taxAmount) setTaxAmount(String(p.taxAmount));
      setScannedTotal(p.totalAmount);
      if (p.items.length) {
        setRows(
          p.items.map((i) => ({
            description: i.description,
            category: i.category,
            quantity: String(i.quantity),
            unitCost: String(i.unitCost),
            sellingPrice: "",
          }))
        );
      }
      setScanNote(
        p.items.length
          ? `Scan finished: ${p.items.length} item(s) found. Please check every line before saving.`
          : "Scan finished but no item lines were recognised. Please enter the items manually."
      );
    } catch (e) {
      console.error(e);
      setError("Scan failed. You can still enter the invoice manually.");
    } finally {
      setScanning(false);
    }
  }

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const subtotal = rows.reduce((s, r) => s + num(r.quantity) * num(r.unitCost), 0);
  const total = subtotal + num(taxAmount);

  async function save() {
    setError("");
    const items = rows.filter((r) => r.description.trim());
    if (!supplierName.trim()) return setError("Supplier name is required");
    if (!invoiceNo.trim()) return setError("Supplier invoice number is required");
    if (items.length === 0) return setError("Add at least one item");
    setSaving(true);
    try {
      const res = await fetch("/api/supplier-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierName,
          invoiceNo,
          invoiceDate,
          dueDate: dueDate || null,
          taxAmount: num(taxAmount),
          notes,
          imageUrl,
          items: items.map((r) => ({
            description: r.description,
            category: r.category,
            quantity: num(r.quantity),
            unitCost: num(r.unitCost),
            sellingPrice: r.sellingPrice ? num(r.sellingPrice) : undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Save failed");
        return;
      }
      router.push(`/supplier-invoices/${data.id}`);
      router.refresh();
    } catch {
      setError("Network error, please retry");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-semibold text-slate-900">Scan Supplier Invoice</h2>
        <p className="mb-3 text-sm text-slate-500">
          Take a photo or choose an image of the supplier invoice. Text is read on this computer (no internet needed),
          then you check it before it goes into stock.
        </p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800">
          <ScanLine className="h-4 w-4" />
          {scanning ? `Scanning... ${progress}%` : "Scan / Choose Image"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={scanning}
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {scanNote && <p className="mt-3 text-sm text-emerald-700">{scanNote}</p>}
        {scannedTotal > 0 && Math.abs(scannedTotal - total) > 0.05 && (
          <p className="mt-1 text-sm text-amber-700">
            The invoice total read from the image is {formatCurrency(scannedTotal)} but the lines below add up to{" "}
            {formatCurrency(total)}. Please check quantities and prices.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-900">Invoice Details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-slate-600">Supplier *</label>
            <input list="supplier-list" className={input} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
            <datalist id="supplier-list">
              {suppliers.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">Supplier Invoice No. *</label>
            <input className={input} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">Invoice Date</label>
            <input type="date" className={input} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">Due Date (optional)</label>
            <input type="date" className={input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-900">Items (go into stock when saved)</h2>
        <datalist id="cat-list">
          {CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-slate-100 p-3 sm:grid-cols-12">
              <input className={input + " sm:col-span-4"} placeholder="Item description" value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} />
              <input list="cat-list" className={input + " sm:col-span-2"} placeholder="Category" value={r.category} onChange={(e) => setRow(i, { category: e.target.value })} />
              <input className={input + " sm:col-span-1"} placeholder="Qty" inputMode="decimal" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} />
              <input className={input + " sm:col-span-2"} placeholder="Unit cost" inputMode="decimal" value={r.unitCost} onChange={(e) => setRow(i, { unitCost: e.target.value })} />
              <input className={input + " sm:col-span-2"} placeholder="Selling price (optional)" inputMode="decimal" value={r.sellingPrice} onChange={(e) => setRow(i, { sellingPrice: e.target.value })} />
              <button type="button" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== i) : rs))} className="inline-flex items-center justify-center rounded-lg p-2 text-red-600 hover:bg-red-50 sm:col-span-1" aria-label="Remove">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setRows((rs) => [...rs, emptyRow()])} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          <Plus className="h-4 w-4" />
          Add Item
        </button>
        <p className="mt-2 text-xs text-slate-500">If the selling price is left empty, new stock items are priced at cost + 30%. You can change it later in Inventory.</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-slate-600">Tax on invoice (RM, optional)</label>
            <input className={input} inputMode="decimal" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">Notes</label>
            <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 text-right text-sm text-slate-600">
          Subtotal {formatCurrency(subtotal)} · <span className="font-semibold text-slate-900">Total {formatCurrency(total)}</span>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <button type="button" onClick={save} disabled={saving || scanning} className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
        {saving ? "Saving..." : "Save & Add to Stock"}
      </button>
    </div>
  );
}

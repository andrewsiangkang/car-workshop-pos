"use client";

import { Header } from "@/components/layout/Header";
import { useEffect, useState } from "react";
import { UpdatePanel } from "@/components/settings/UpdatePanel";
import { AutoBackupPanel } from "@/components/settings/AutoBackupPanel";
import { StaffPanel } from "@/components/settings/StaffPanel";
import {
  Save,
  Building2,
  FileText,
  CreditCard,
  Download,
  HardDrive,
  Users,
} from "lucide-react";

type ShopForm = {
  name: string;
  nameMs: string;
  address: string;
  phone: string;
  email: string;
  tin: string;
  brn: string;
  sstNumber: string;
  msicCode: string;
  msicDesc: string;
  myInvoisClientId: string;
  myInvoisClientSecret: string;
  myInvoisSandbox: boolean;
  bankName: string;
  bankAccount: string;
  paymentQrUrl: string;
  receiptFooter: string;
};

const emptyForm: ShopForm = {
  name: "",
  nameMs: "",
  address: "",
  phone: "",
  email: "",
  tin: "",
  brn: "",
  sstNumber: "NA",
  msicCode: "",
  msicDesc: "",
  myInvoisClientId: "",
  myInvoisClientSecret: "",
  myInvoisSandbox: true,
  bankName: "",
  bankAccount: "",
  paymentQrUrl: "",
  receiptFooter: "Thank you for your business. We look forward to serving you again!",
};

export default function SettingsPage() {
  const [form, setForm] = useState<ShopForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"basic" | "tax" | "bank" | "backup" | "staff">("basic");
  const [backupMsg, setBackupMsg] = useState("");

  useEffect(() => {
    fetch("/api/shop")
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) {
          setForm({
            name: data.name || "",
            nameMs: data.nameMs || "",
            address: data.address || "",
            phone: data.phone || "",
            email: data.email || "",
            tin: data.tin || "",
            brn: data.brn || "",
            sstNumber: data.sstNumber || "NA",
            msicCode: data.msicCode || "",
            msicDesc: data.msicDesc || "",
            myInvoisClientId: data.myInvoisClientId || "",
            myInvoisClientSecret: data.myInvoisClientSecret || "",
            myInvoisSandbox: data.myInvoisSandbox !== false,
            bankName: data.bankName || "",
            bankAccount: data.bankAccount || "",
            paymentQrUrl: data.paymentQrUrl || "",
            receiptFooter: data.receiptFooter || "Thank you for your business. We look forward to serving you again!",
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function update(field: keyof ShopForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setMessage("");
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/shop", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage("Saved successfully");
      } else {
        setMessage(data.error || "Save failed");
      }
    } catch {
      setMessage("Network error, please retry");
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadBackup() {
    setBackupMsg("Preparing backup...");
    try {
      const res = await fetch("/api/backup");
      if (!res.ok) {
        const data = await res.json();
        setBackupMsg(data.error || "Backup failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `workshop-backup-${new Date().toISOString().slice(0, 10)}.db`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupMsg("Backup file downloaded to your computer");
    } catch {
      setBackupMsg("Download failed");
    }
  }

  async function handleLocalBackup() {
    setBackupMsg("Backing up to server backups folder...");
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      const data = await res.json();
      setBackupMsg(data.message || data.error || "Done");
    } catch {
      setBackupMsg("Local backup failed");
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-500">
        Loading...
      </div>
    );
  }

  return (
    <div>
      <Header
        title="Settings"
        description="Shop details, tax info and backup"
        actions={
          activeTab !== "backup" && activeTab !== "staff" ? (
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : message === "Saved successfully" ? "Saved ✓" : "Save Settings"}
            </button>
          ) : null
        }
      />

      {message && (
        <div
          className={`mb-4 rounded-lg px-4 py-2 text-sm ${
            message.includes("success") || message.includes("Saved")
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {message}
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 w-fit">
        {[
          { id: "basic" as const, label: "Basic Info", icon: Building2 },
          { id: "tax" as const, label: "Tax / e-Invoice", icon: FileText },
          { id: "bank" as const, label: "Bank & Receipt", icon: CreditCard },
          { id: "staff" as const, label: "Staff", icon: Users },
          { id: "backup" as const, label: "Backup", icon: HardDrive },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition ${
                activeTab === tab.id
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {activeTab === "basic" && (
          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Shop Name *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Shop Name (Malay)
              </label>
              <input
                type="text"
                value={form.nameMs}
                onChange={(e) => update("nameMs", e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Address
              </label>
              <textarea
                rows={3}
                value={form.address}
                onChange={(e) => update("address", e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Phone
                </label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Email
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === "tax" && (
          <div className="space-y-5">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              For official invoices and MyInvois e-Invoice. Fill in LHDN registration details.
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                TIN (Tax Identification Number)
              </label>
              <input
                type="text"
                value={form.tin}
                onChange={(e) => update("tin", e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                placeholder="C1234567890 or IG..."
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                BRN (Business Registration Number)
              </label>
              <input
                type="text"
                value={form.brn}
                onChange={(e) => update("brn", e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                SST Registration No.
              </label>
              <input
                type="text"
                value={form.sstNumber}
                onChange={(e) => update("sstNumber", e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                placeholder="Enter NA if none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                MSIC Code
              </label>
              <input
                type="text"
                value={form.msicCode}
                onChange={(e) => update("msicCode", e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Business Activity Description</label>
              <input value={form.msicDesc} onChange={(e) => update("msicDesc", e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" placeholder="e.g. Maintenance and repair of motor vehicles" />
            </div>
            <hr className="my-4" />
            <h4 className="text-sm font-semibold text-slate-800">MyInvois API Credentials</h4>
            <p className="text-xs text-slate-500">From MyInvois Portal → View and Register ERP. Use Sandbox first.</p>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Client ID</label>
              <input value={form.myInvoisClientId} onChange={(e) => update("myInvoisClientId", e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Client Secret</label>
              <input type="password" value={form.myInvoisClientSecret} onChange={(e) => update("myInvoisClientSecret", e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.myInvoisSandbox} onChange={(e) => update("myInvoisSandbox", e.target.checked)} />
              Use Sandbox (preprod) environment
            </label>
          </div>
        )}

        {activeTab === "bank" && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Bank Name
                </label>
                <input
                  type="text"
                  value={form.bankName}
                  onChange={(e) => update("bankName", e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Bank Account
                </label>
                <input
                  type="text"
                  value={form.bankAccount}
                  onChange={(e) => update("bankAccount", e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Payment QR Image
              </label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="flex-1">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const fd = new FormData();
                      fd.append("file", file);
                      const res = await fetch("/api/upload", { method: "POST", body: fd });
                      const data = await res.json();
                      if (res.ok && data.url) update("paymentQrUrl", data.url);
                      else alert(data.error || "Upload failed");
                    }}
                    className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
                  />
                  <p className="mt-1 text-xs text-slate-500">Upload PNG/JPG (max 2MB). Shown on Invoice.</p>
                  {form.paymentQrUrl && (
                    <button type="button" onClick={() => update("paymentQrUrl", "")} className="mt-2 text-xs text-red-600 hover:underline">Remove QR</button>
                  )}
                </div>
                {form.paymentQrUrl && (
                  <img src={form.paymentQrUrl} alt="QR preview" className="h-24 w-24 rounded border border-slate-200 object-contain bg-white" />
                )}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Receipt Footer Text
              </label>
              <textarea
                rows={3}
                value={form.receiptFooter}
                onChange={(e) => update("receiptFooter", e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
          </div>
        )}

        {activeTab === "staff" && <StaffPanel />}

        {activeTab === "backup" && (
          <div className="space-y-6">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
              All data is stored on this computer. Please back up regularly. Recommended at least once a week, and copy to phone or external drive.
            </div>
            <AutoBackupPanel />
            <div className="space-y-3">
              <button
                onClick={handleDownloadBackup}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-blue-300 hover:bg-blue-50/50"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                  <Download className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-medium text-slate-900">Download Backup to Computer</div>
                  <div className="text-xs text-slate-500">
                    Download .db file to save to USB or cloud
                  </div>
                </div>
              </button>
              <button
                onClick={handleLocalBackup}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-blue-300 hover:bg-blue-50/50"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                  <HardDrive className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-medium text-slate-900">Backup to data folder now</div>
                  <div className="text-xs text-slate-500">
                    Creates one extra timestamped copy in the app data folder
                  </div>
                </div>
              </button>
            </div>
            {backupMsg && (
              <div className="rounded-lg bg-slate-50 px-4 py-2 text-sm text-slate-700">
                {backupMsg}
              </div>
            )}
          </div>
        )}
      </div>
      <UpdatePanel />
    </div>
  );
}

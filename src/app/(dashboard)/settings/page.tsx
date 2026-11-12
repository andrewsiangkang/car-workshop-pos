"use client";

import { Header } from "@/components/layout/Header";
import { useEffect, useState } from "react";
import { UpdatePanel } from "@/components/settings/UpdatePanel";
import { AutoBackupPanel } from "@/components/settings/AutoBackupPanel";
import { StaffPanel } from "@/components/settings/StaffPanel";
import { ConnectPanel } from "@/components/settings/ConnectPanel";
import { DocumentTemplatePanel } from "@/components/settings/DocumentTemplatePanel";
import { MY_STATES } from "@/lib/my-states";
import { AUTOMOTIVE_MSIC_CODES } from "@/data/msic-codes";
import {
  Save,
  Building2,
  FileText,
  CreditCard,
  Download,
  HardDrive,
  Users,
  Smartphone,
  Search,
  Check,
} from "lucide-react";

type ShopForm = {
  name: string;
  nameMs: string;
  address: string;
  city: string;
  postcode: string;
  stateCode: string;
  phone: string;
  email: string;
  tin: string;
  brn: string;
  sstNumber: string;
  sstRate: string;
  sstScope: string;
  msicCode: string;
  msicDesc: string;
  myInvoisClientId: string;
  myInvoisClientSecret: string;
  myInvoisSandbox: boolean;
  bankName: string;
  bankAccount: string;
  paymentQrUrl: string;
  receiptFooter: string;
  countryCode: string;
  currencyCode: string;
  locale: string;
  timeZone: string;
  taxLabel: string;
};

const emptyForm: ShopForm = {
  name: "",
  nameMs: "",
  address: "",
  city: "",
  postcode: "",
  stateCode: "",
  phone: "",
  email: "",
  tin: "",
  brn: "",
  sstNumber: "NA",
  sstRate: "0",
  sstScope: "ALL",
  msicCode: "",
  msicDesc: "",
  myInvoisClientId: "",
  myInvoisClientSecret: "",
  myInvoisSandbox: true,
  bankName: "",
  bankAccount: "",
  paymentQrUrl: "",
  receiptFooter: "Thank you for your business. We look forward to serving you again!",
  countryCode: "MY",
  currencyCode: "MYR",
  locale: "en-MY",
  timeZone: "Asia/Kuala_Lumpur",
  taxLabel: "SST",
};

export default function SettingsPage() {
  const [form, setForm] = useState<ShopForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"basic" | "international" | "tax" | "bank" | "documents" | "backup" | "staff" | "connect">("basic");
  const [backupMsg, setBackupMsg] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [msicSearch, setMsicSearch] = useState("");
  const [showMsicResults, setShowMsicResults] = useState(false);
  const filteredMsicCodes = AUTOMOTIVE_MSIC_CODES.filter((item) =>
    `${item.code} ${item.description} ${item.keywords}`.toLowerCase().includes(msicSearch.trim().toLowerCase())
  ).slice(0, 10);

  useEffect(() => {
    fetch("/api/shop")
      .then((r) => r.json())
      .then((data) => {
        setHasSecret(!!data.hasMyInvoisSecret);
        if (!data.error) {
          if (data.msicCode) setMsicSearch(`${data.msicCode}${data.msicDesc ? ` — ${data.msicDesc}` : ""}`);
          setForm({
            name: data.name || "",
            nameMs: data.nameMs || "",
            address: data.address || "",
            city: data.city || "",
            postcode: data.postcode || "",
            stateCode: data.stateCode || "",
            phone: data.phone || "",
            email: data.email || "",
            tin: data.tin || "",
            brn: data.brn || "",
            sstNumber: data.sstNumber || "NA",
            sstRate: String(data.sstRate ?? 0),
            sstScope: data.sstScope === "LABOR" ? "LABOR" : "ALL",
            msicCode: data.msicCode || "",
            msicDesc: data.msicDesc || "",
            myInvoisClientId: data.myInvoisClientId || "",
            myInvoisClientSecret: "", // never sent back by the server

            myInvoisSandbox: data.myInvoisSandbox !== false,
            bankName: data.bankName || "",
            bankAccount: data.bankAccount || "",
            paymentQrUrl: data.paymentQrUrl || "",
            receiptFooter: data.receiptFooter || "Thank you for your business. We look forward to serving you again!",
            countryCode: data.countryCode || "MY",
            currencyCode: data.currencyCode || "MYR",
            locale: data.locale || "en-MY",
            timeZone: data.timeZone || "Asia/Kuala_Lumpur",
            taxLabel: data.taxLabel || "SST",
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function update(field: keyof ShopForm, value: string | boolean) {
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
        setHasSecret(!!data.hasMyInvoisSecret);
        setForm((prev) => ({ ...prev, myInvoisClientSecret: "" }));
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
          activeTab !== "backup" && activeTab !== "staff" && activeTab !== "connect" && activeTab !== "documents" ? (
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
          { id: "international" as const, label: "International", icon: Search },
          { id: "tax" as const, label: "Tax / e-Invoice", icon: FileText },
          { id: "bank" as const, label: "Bank & Receipt", icon: CreditCard },
          { id: "documents" as const, label: "Document Templates", icon: FileText },
          { id: "staff" as const, label: "Staff", icon: Users },
          { id: "connect" as const, label: "Phone / Tablet", icon: Smartphone },
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
                Street Address
              </label>
              <textarea
                rows={2}
                value={form.address}
                onChange={(e) => update("address", e.target.value)}
                placeholder="e.g. No. 12, Jalan Perusahaan 3, Taman Industri"
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Postcode</label>
                <input
                  inputMode="numeric"
                  maxLength={5}
                  value={form.postcode}
                  onChange={(e) => update("postcode", e.target.value.replace(/\D/g, ""))}
                  placeholder="e.g. 47500"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">City</label>
                <input
                  value={form.city}
                  onChange={(e) => update("city", e.target.value)}
                  placeholder="e.g. Subang Jaya"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">State</label>
                <select
                  value={form.stateCode}
                  onChange={(e) => update("stateCode", e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                >
                  <option value="">Select state…</option>
                  {Object.entries(MY_STATES).map(([code, name]) => (
                    <option key={code} value={code}>{name}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="-mt-2 text-xs text-slate-500">Postcode, city and state are required on LHDN e-Invoices.</p>
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

        {activeTab === "international" && (
        <div className="max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">International Business Settings</h2>
          <p className="mt-1 text-sm text-slate-500">Set the workshop's country, default currency, language, time zone and tax label. Existing Malaysian data remains MYR by default.</p>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">Country
              <select value={form.countryCode} onChange={(e) => update("countryCode", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="MY">Malaysia</option><option value="SG">Singapore</option><option value="AU">Australia</option><option value="GB">United Kingdom</option><option value="US">United States</option><option value="IN">India</option><option value="ID">Indonesia</option><option value="TH">Thailand</option><option value="VN">Vietnam</option><option value="JP">Japan</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">Default Currency
              <select value={form.currencyCode} onChange={(e) => update("currencyCode", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="MYR">MYR — Malaysian Ringgit</option><option value="SGD">SGD — Singapore Dollar</option><option value="AUD">AUD — Australian Dollar</option><option value="GBP">GBP — Pound Sterling</option><option value="USD">USD — US Dollar</option><option value="INR">INR — Indian Rupee</option><option value="IDR">IDR — Indonesian Rupiah</option><option value="THB">THB — Thai Baht</option><option value="VND">VND — Vietnamese Dong</option><option value="JPY">JPY — Japanese Yen</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">Default Language / Locale
              <select value={form.locale} onChange={(e) => update("locale", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="en-MY">English (Malaysia)</option><option value="zh-MY">中文（马来西亚）</option><option value="ms-MY">Bahasa Melayu</option><option value="en-SG">English (Singapore)</option><option value="en-AU">English (Australia)</option><option value="en-GB">English (UK)</option><option value="en-US">English (US)</option><option value="en-IN">English (India)</option><option value="en-ID">English (Indonesia)</option><option value="th-TH">ไทย</option><option value="vi-VN">Tiếng Việt</option><option value="ja-JP">日本語</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">Time Zone
              <input value={form.timeZone} onChange={(e) => update("timeZone", e.target.value)} placeholder="Asia/Kuala_Lumpur" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">Tax Label
              <input value={form.taxLabel} onChange={(e) => update("taxLabel", e.target.value)} placeholder="SST / GST / VAT" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              <span className="mt-1 block text-xs font-normal text-slate-500">This configures the business label only. Country-specific tax calculation and e-invoice compliance still require separate validation.</span>
            </label>
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Service Tax Rate (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={form.sstRate}
                  onChange={(e) => update("sstRate", e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                  placeholder="e.g. 8"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Tax Applies To</label>
                <select
                  value={form.sstScope}
                  onChange={(e) => update("sstScope", e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                >
                  <option value="ALL">Parts + labour (whole repair bill)</option>
                  <option value="LABOR">Labour only</option>
                </select>
              </div>
            </div>
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              Service tax is only charged when an SST Registration No. is filled in (not &quot;NA&quot;) and the rate is above 0.
              Prices are entered before tax. New quotes use this rate, and the rate is fixed when the invoice is generated.
              Confirm the correct rate and what it applies to with JKDM or your tax agent.
            </p>
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
              <div className="mb-1 text-sm font-semibold text-slate-800">Find MSIC business activity code</div>
              <p className="mb-3 text-xs leading-5 text-slate-600">
                Search the built-in automotive activity list by code or keyword (English / BM). Select a result to fill the code and description automatically. No need to open the LHDN website for these common workshop activities.
              </p>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  type="search"
                  value={msicSearch}
                  onFocus={() => setShowMsicResults(true)}
                  onChange={(e) => { setMsicSearch(e.target.value); setShowMsicResults(true); }}
                  placeholder="Search: 45201, car repair, bengkel, car wash..."
                  className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
                  aria-label="Search MSIC code and business activity"
                />
              </div>
              {showMsicResults && (
                <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  {filteredMsicCodes.length ? filteredMsicCodes.map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => {
                        update("msicCode", item.code);
                        update("msicDesc", item.description);
                        setMsicSearch(`${item.code} — ${item.description}`);
                        setShowMsicResults(false);
                      }}
                      className="flex w-full items-start gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-0 hover:bg-blue-50"
                    >
                      <span className="rounded bg-slate-100 px-2 py-1 font-mono text-xs font-semibold text-slate-800">{item.code}</span>
                      <span className="flex-1 text-xs leading-5 text-slate-700">{item.description}</span>
                      {form.msicCode === item.code && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
                    </button>
                  )) : <p className="px-3 py-4 text-xs text-slate-500">No matching automotive activity. You can still enter a code manually below.</p>}
                </div>
              )}
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Selected MSIC Code (5 digits)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={form.msicCode}
                    onChange={(e) => update("msicCode", e.target.value.replace(/\D/g, "").slice(0, 5))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                    placeholder="e.g. 45201"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Business Activity Description</label>
                  <input value={form.msicDesc} onChange={(e) => update("msicDesc", e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm" placeholder="Maintenance and repair of motor vehicles" />
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-slate-500">
                This is a quick list of common motor-vehicle activities, not the complete MSIC directory. Confirm that the selected activity matches the business registered with SSM / LHDN. Official reference: <a className="underline" href="https://sdk.myinvois.hasil.gov.my/codes/msic-codes/" target="_blank" rel="noreferrer">MyInvois MSIC codes</a>.
              </p>
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
              <input type="password" autoComplete="new-password" value={form.myInvoisClientSecret} onChange={(e) => update("myInvoisClientSecret", e.target.value)} placeholder={hasSecret ? "Saved (hidden) - type a new one to replace" : ""} className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.myInvoisSandbox} onChange={(e) => update("myInvoisSandbox", e.target.checked)} />
              Use Sandbox (preprod) environment
            </label>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
              <div className="font-semibold text-amber-900">Digital signature (important)</div>
              <p className="mt-1 leading-relaxed">
                This version submits unsigned JSON documents (hash only). <strong>Production</strong> MyInvois often
                requires a Malaysian digital certificate (XAdES). Prefer <strong>Sandbox</strong> for testing.
                Going live without external signing may result in LHDN rejecting submissions.
              </p>
              <p className="mt-1 leading-relaxed text-amber-900/90">
                本版本仅提交未签名的 JSON（仅哈希）。正式环境通常需要数字证书签名；请优先用沙盒联调。未签名直接上正式环境可能被 LHDN 拒绝。
              </p>
            </div>
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

        {activeTab === "documents" && <DocumentTemplatePanel />}
        {activeTab === "staff" && <StaffPanel />}

        {activeTab === "connect" && <ConnectPanel />}

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

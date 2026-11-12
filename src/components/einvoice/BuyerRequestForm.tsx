"use client";

import { useState } from "react";

type Lang = "en" | "zh" | "ms";

const T: Record<string, Record<Lang, string>> = {
  title: { en: "Request e-Invoice", zh: "申请电子发票 (e-Invoice)", ms: "Minta e-Invois" },
  intro: {
    en: "Fill in your details below. The workshop will issue your e-Invoice to LHDN MyInvois.",
    zh: "请填写你的资料，修车店会为你向 LHDN MyInvois 开具电子发票。",
    ms: "Sila isi maklumat anda. Bengkel akan mengeluarkan e-Invois anda kepada LHDN MyInvois.",
  },
  invoice: { en: "Invoice", zh: "发票", ms: "Invois" },
  total: { en: "Total", zh: "总额", ms: "Jumlah" },
  name: { en: "Name / Company name (as in IC / SSM)", zh: "姓名 / 公司名（与 IC / SSM 一致）", ms: "Nama / Nama syarikat (seperti IC / SSM)" },
  tin: { en: "TIN (Tax Identification Number)", zh: "TIN（税务识别号）", ms: "TIN (Nombor Pengenalan Cukai)" },
  tinHelp: {
    en: "Individuals start with IG, companies with C. Check in MyTax.",
    zh: "个人以 IG 开头，公司以 C 开头。可在 MyTax 查询。",
    ms: "Individu bermula dengan IG, syarikat dengan C. Semak di MyTax.",
  },
  msicNotRequired: {
    en: "You do not need to find or enter an MSIC code for this buyer e-Invoice request.",
    zh: "申请这张顾客电子发票不需要查询或填写 MSIC 行业代码。",
    ms: "Anda tidak perlu mencari atau mengisi kod MSIC untuk permintaan e-Invois pembeli ini.",
  },
  idType: { en: "ID type", zh: "证件类型", ms: "Jenis ID" },
  NRIC: { en: "NRIC (IC)", zh: "身份证 (IC)", ms: "NRIC (IC)" },
  PASSPORT: { en: "Passport", zh: "护照", ms: "Pasport" },
  BRN: { en: "Business registration (SSM)", zh: "公司注册号 (SSM)", ms: "No. pendaftaran perniagaan (SSM)" },
  ARMY: { en: "Army ID", zh: "军人证", ms: "ID Tentera" },
  idNo: { en: "ID number", zh: "证件号码", ms: "Nombor ID" },
  idNoHelp: { en: "NRIC: 12 digits, no dashes", zh: "IC：12 位数字，不要横线", ms: "NRIC: 12 digit, tanpa sengkang" },
  email: { en: "Email (optional)", zh: "Email（选填）", ms: "E-mel (pilihan)" },
  phone: { en: "Phone (optional)", zh: "电话（选填）", ms: "Telefon (pilihan)" },
  address: { en: "Address", zh: "地址", ms: "Alamat" },
  postcode: { en: "Postcode", zh: "邮编", ms: "Poskod" },
  city: { en: "City", zh: "城市", ms: "Bandar" },
  state: { en: "State", zh: "州属", ms: "Negeri" },
  choose: { en: "Select", zh: "请选择", ms: "Pilih" },
  submit: { en: "Send", zh: "提交", ms: "Hantar" },
  sending: { en: "Sending...", zh: "提交中...", ms: "Menghantar..." },
  fixFields: { en: "Please check the fields marked in red.", zh: "请检查红色标出的栏位。", ms: "Sila semak ruangan bertanda merah." },
  failed: { en: "Could not send. Please try again or ask the staff.", zh: "提交失败，请重试或询问店员。", ms: "Gagal menghantar. Sila cuba lagi atau tanya kakitangan." },
  tooMany: { en: "Too many tries. Please wait a few minutes.", zh: "尝试次数过多，请稍等几分钟。", ms: "Terlalu banyak percubaan. Sila tunggu beberapa minit." },
  doneTitle: { en: "Thank you!", zh: "谢谢！", ms: "Terima kasih!" },
  doneBody: {
    en: "Your details were sent. The workshop will issue your e-Invoice. You can send again to correct a mistake until it is issued.",
    zh: "资料已提交，修车店会为你开具电子发票。在开具之前，如填错可以重新提交更正。",
    ms: "Maklumat anda telah dihantar. Bengkel akan mengeluarkan e-Invois anda. Anda boleh hantar semula untuk membetulkan kesilapan sebelum ia dikeluarkan.",
  },
  sentBefore: {
    en: "Details were already sent for this invoice. Submit again only to correct them.",
    zh: "这张发票已经提交过资料。只有需要更正时才再提交。",
    ms: "Maklumat untuk invois ini telah dihantar. Hantar semula hanya untuk membetulkan.",
  },
  notFound: { en: "This link is not valid. Please ask the workshop for a new QR code.", zh: "此链接无效，请向修车店索取新的二维码。", ms: "Pautan ini tidak sah. Sila minta kod QR baharu daripada bengkel." },
  submitted: {
    en: "The e-Invoice for this invoice has already been issued.",
    zh: "这张发票的电子发票已经开具。",
    ms: "e-Invois untuk invois ini telah pun dikeluarkan.",
  },
  consolidated: {
    en: "This invoice was already reported in the monthly consolidated e-Invoice, so an individual e-Invoice can no longer be requested here. Please contact the workshop.",
    zh: "这张发票已并入每月合并电子发票，无法在这里再申请个别电子发票。请联系修车店。",
    ms: "Invois ini telah dilaporkan dalam e-Invois disatukan bulanan, jadi e-Invois individu tidak boleh diminta di sini. Sila hubungi bengkel.",
  },
  privacy: {
    en: "Your details are used only to issue your e-Invoice.",
    zh: "你的资料只用于开具电子发票。",
    ms: "Maklumat anda hanya digunakan untuk mengeluarkan e-Invois anda.",
  },
};

type Props = {
  token: string;
  found: boolean;
  lock: "none" | "no_invoice" | "submitted" | "consolidated";
  alreadySent: boolean;
  shopName: string;
  shopPhone: string;
  invoiceNumber: string;
  total: number;
  states: { code: string; name: string }[];
};

const inputCls = (bad: boolean) =>
  `w-full rounded-lg border px-3 py-2.5 text-base ${bad ? "border-red-400 bg-red-50" : "border-slate-300 bg-white"}`;

export function BuyerRequestForm(p: Props) {
  const [lang, setLang] = useState<Lang>("en");
  const t = (k: string) => T[k]?.[lang] ?? k;
  const [f, setF] = useState({
    name: "", tin: "", idType: "NRIC", idNo: "", email: "", phone: "", address: "", postcode: "", city: "", stateCode: "",
  });
  const [bad, setBad] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    setBad({});
    try {
      const res = await fetch(`/api/public/einvoice/${p.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setDone(true);
      else if (res.status === 422) {
        setBad(data.fields || {});
        setMsg(t("fixFields"));
      } else if (res.status === 429) setMsg(t("tooMany"));
      else if (res.status === 409) setMsg(t(data.error === "consolidated" ? "consolidated" : "submitted"));
      else setMsg(t("failed"));
    } catch {
      setMsg(t("failed"));
    }
    setBusy(false);
  }

  const header = (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <div className="text-sm text-slate-500">{p.shopName}</div>
        <h1 className="text-xl font-bold text-slate-900">{t("title")}</h1>
      </div>
      <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-300 text-sm">
        {(["en", "zh", "ms"] as Lang[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            className={`px-2.5 py-1.5 ${lang === l ? "bg-blue-700 text-white" : "bg-white text-slate-700"}`}
          >
            {l === "en" ? "EN" : l === "zh" ? "中文" : "BM"}
          </button>
        ))}
      </div>
    </div>
  );

  const note = (text: string, tone: "red" | "amber" = "amber") => (
    <div className={`rounded-xl border p-4 text-sm ${tone === "red" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      {text}
      {p.shopPhone && <div className="mt-2 font-medium">Tel: {p.shopPhone}</div>}
    </div>
  );

  if (!p.found) return <>{header}{note(t("notFound"), "red")}</>;
  if (p.lock === "no_invoice") return <>{header}{note(t("notFound"), "red")}</>;
  if (p.lock === "submitted") return <>{header}{note(t("submitted"))}</>;
  if (p.lock === "consolidated") return <>{header}{note(t("consolidated"))}</>;

  if (done) {
    return (
      <>
        {header}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
          <div className="mb-1 text-lg font-semibold">{t("doneTitle")}</div>
          <p className="text-sm">{t("doneBody")}</p>
        </div>
      </>
    );
  }

  const field = (k: keyof typeof f, label: string, opts?: { help?: string; type?: string; inputMode?: "numeric" | "tel" | "email" | "text"; maxLength?: number; auto?: string }) => (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <input
        value={f[k]}
        onChange={set(k)}
        type={opts?.type || "text"}
        inputMode={opts?.inputMode}
        maxLength={opts?.maxLength}
        autoComplete={opts?.auto}
        className={inputCls(!!bad[k])}
      />
      {opts?.help && <div className="mt-1 text-xs text-slate-500">{opts.help}</div>}
    </div>
  );

  return (
    <>
      {header}
      <p className="mb-3 text-sm text-slate-600">{t("intro")}</p>
      <div className="mb-4 flex justify-between rounded-lg bg-slate-100 px-3 py-2 text-sm">
        <span>{t("invoice")}: <b>{p.invoiceNumber}</b></span>
        <span>{t("total")}: <b>RM {p.total.toFixed(2)}</b></span>
      </div>
      {p.alreadySent && <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("sentBefore")}</div>}

      <form onSubmit={send} className="space-y-3.5" noValidate>
        {field("name", t("name"), { auto: "name" })}
        {field("tin", t("tin"), { help: t("tinHelp") })}
        <p className="-mt-1 text-xs text-emerald-700">{t("msicNotRequired")}</p>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">{t("idType")}</label>
          <select value={f.idType} onChange={set("idType")} className={inputCls(!!bad.idType)}>
            {["NRIC", "PASSPORT", "BRN", "ARMY"].map((k) => (
              <option key={k} value={k}>{t(k)}</option>
            ))}
          </select>
        </div>
        {field("idNo", t("idNo"), { help: f.idType === "NRIC" ? t("idNoHelp") : undefined, inputMode: f.idType === "NRIC" ? "numeric" : "text" })}
        {field("email", t("email"), { type: "email", inputMode: "email", auto: "email" })}
        {field("phone", t("phone"), { type: "tel", inputMode: "tel", auto: "tel" })}
        {field("address", t("address"), { auto: "street-address" })}
        <div className="grid grid-cols-2 gap-3">
          {field("postcode", t("postcode"), { inputMode: "numeric", maxLength: 5, auto: "postal-code" })}
          {field("city", t("city"), { auto: "address-level2" })}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">{t("state")}</label>
          <select value={f.stateCode} onChange={set("stateCode")} className={inputCls(!!bad.stateCode)}>
            <option value="">{t("choose")}</option>
            {p.states.map((s) => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </select>
        </div>

        {msg && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-blue-700 py-3 text-base font-semibold text-white disabled:opacity-60">
          {busy ? t("sending") : t("submit")}
        </button>
        <p className="text-center text-xs text-slate-400">{t("privacy")}</p>
      </form>
    </>
  );
}

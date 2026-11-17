"use client";

import { useState } from "react";
import { BUYER_LIMITS, checkBuyerFields, type BuyerRequestLock } from "@/lib/einvoice-rules.mjs";

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
    en: "Needed for a company, passport or army ID. Companies start with C, individuals with IG. Check in MyTax.",
    zh: "公司、护照或军人证必须填写。公司以 C 开头，个人以 IG 开头。可在 MyTax 查询。",
    ms: "Diperlukan bagi syarikat, pasport atau ID tentera. Syarikat bermula dengan C, individu dengan IG. Semak di MyTax.",
  },
  // LHDN e-Invoice Specific Guideline: a Malaysian individual who gives no TIN is sent with LHDN's
  // general TIN for individuals together with the MyKad number (confirm with the tax agent).
  tinOptional: {
    en: "TIN (optional for a Malaysian IC)",
    zh: "TIN（持马来西亚身份证可不填）",
    ms: "TIN (pilihan bagi pemegang IC Malaysia)",
  },
  tinOptionalHelp: {
    en: "Don't know your TIN? Leave it blank. Your e-Invoice will then use LHDN's general TIN for individuals (EI00000000010) together with your IC number, as LHDN allows. If you know it (starts with IG), you can enter it.",
    zh: "不知道自己的 TIN？可以不填。电子发票会按 LHDN 的规定，使用个人通用 TIN（EI00000000010）加上你的身份证号码。知道的话（IG 开头）也可以填上。",
    ms: "Tidak tahu TIN anda? Biarkan kosong. e-Invois anda akan menggunakan TIN am LHDN untuk individu (EI00000000010) bersama nombor IC anda, seperti yang dibenarkan oleh LHDN. Jika anda tahu (bermula dengan IG), anda boleh mengisinya.",
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
  idNoHelp: { en: "NRIC: the 12 digits of your IC", zh: "IC：身份证上的 12 位数字", ms: "NRIC: 12 digit pada IC anda" },
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
  until: {
    en: "You can send or correct your details until {date}.",
    zh: "你可以在 {date} 之前提交或更正资料。",
    ms: "Anda boleh menghantar atau membetulkan maklumat sehingga {date}.",
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
  staff_saved: {
    en: "The workshop has already entered the e-Invoice details for this invoice. To change them, please contact the workshop.",
    zh: "修车店已为这张发票填好电子发票资料。如需更改，请联系修车店。",
    ms: "Bengkel telah pun memasukkan maklumat e-Invois untuk invois ini. Untuk mengubahnya, sila hubungi bengkel.",
  },
  expired: {
    en: "Requests for an individual e-Invoice for this invoice closed on {date}. The sale is reported in the workshop's monthly consolidated e-Invoice. Please contact the workshop if you need help.",
    zh: "这张发票申请个别电子发票的期限已于 {date} 截止，这笔交易会并入修车店每月的合并电子发票申报。如需协助，请联系修车店。",
    ms: "Permintaan e-Invois individu untuk invois ini telah ditutup pada {date}. Jualan ini dilaporkan dalam e-Invois disatukan bulanan bengkel. Sila hubungi bengkel jika perlukan bantuan.",
  },
  // Field problems (the server sends "required" | "invalid" | "too_long" per field).
  required: { en: "Required.", zh: "必填。", ms: "Wajib diisi." },
  invalid: { en: "Please check this field.", zh: "请检查此栏。", ms: "Sila semak ruangan ini." },
  tooLong: { en: "Too long: at most {n} characters.", zh: "太长：最多 {n} 个字符。", ms: "Terlalu panjang: maksimum {n} aksara." },
  bad_tin: { en: "TIN: 6 to 20 letters or numbers, no spaces.", zh: "TIN：6 至 20 个字母或数字，不要空格。", ms: "TIN: 6 hingga 20 huruf atau nombor, tanpa ruang." },
  required_tin: {
    en: "Required for a company, passport or army ID. Only a Malaysian IC holder may leave it blank.",
    zh: "公司、护照或军人证必须填写。只有持马来西亚身份证的个人可以不填。",
    ms: "Wajib bagi syarikat, pasport atau ID tentera. Hanya pemegang IC Malaysia boleh membiarkannya kosong.",
  },
  bad_idNo: {
    en: "ID number not valid (IC: the 12 digits of your MyKad; SSM: e.g. 202001012345; passport / army: 5 to 20 letters or numbers).",
    zh: "证件号码不正确（IC：身份证上的 12 位数字；SSM：例如 202001012345；护照 / 军人证：5 至 20 个字母或数字）。",
    ms: "Nombor ID tidak sah (IC: 12 digit MyKad anda; SSM: cth. 202001012345; pasport / tentera: 5 hingga 20 huruf atau nombor).",
  },
  bad_email: { en: "Email address not valid.", zh: "Email 地址不正确。", ms: "Alamat e-mel tidak sah." },
  bad_phone: { en: "Phone number not valid (e.g. 012-345 6789).", zh: "电话号码不正确（例如 012-345 6789）。", ms: "Nombor telefon tidak sah (cth. 012-345 6789)." },
  bad_postcode: { en: "Postcode must be 5 digits.", zh: "邮编必须是 5 位数字。", ms: "Poskod mesti 5 digit." },
  // PDPA (Personal Data Protection Act 2010) notice: who collects, purpose, disclosure, whether
  // obligatory, retention, and how to access / correct. The tick box records consent.
  pdpaTitle: { en: "Personal data notice (PDPA 2010)", zh: "个人资料通知（2010 年个人资料保护法 PDPA）", ms: "Notis data peribadi (PDPA 2010)" },
  pdpaWho: {
    en: "{shop} collects the details on this form: name, ID number, address and, if you give them, TIN, email and phone.",
    zh: "{shop} 收集本表格上的资料：姓名、证件号码、地址，以及你选填的 TIN、Email 和电话。",
    ms: "{shop} mengumpul maklumat dalam borang ini: nama, nombor ID, alamat dan, jika diberi, TIN, e-mel dan telefon.",
  },
  pdpaPurpose: {
    en: "Purpose: only to issue your e-Invoice for this invoice through LHDN MyInvois, as required under the Income Tax Act 1967. The details are sent to LHDN (Inland Revenue Board of Malaysia) and are not used for marketing.",
    zh: "用途：仅用于按 1967 年所得税法的要求，通过 LHDN MyInvois 为这张发票开具你的电子发票。资料会提交给 LHDN（马来西亚内陆税收局），不会用于推销。",
    ms: "Tujuan: hanya untuk mengeluarkan e-Invois anda bagi invois ini melalui LHDN MyInvois, seperti yang dikehendaki di bawah Akta Cukai Pendapatan 1967. Maklumat dihantar kepada LHDN (Lembaga Hasil Dalam Negeri Malaysia) dan tidak digunakan untuk pemasaran.",
  },
  pdpaOptional: {
    en: "Name, ID number and address (and a TIN for a company, passport or army ID) are needed for an individual e-Invoice. If you do not give them, the sale is reported in the workshop's monthly consolidated e-Invoice instead.",
    zh: "开具个别电子发票需要姓名、证件号码和地址（公司、护照或军人证还需要 TIN）。如不提供，这笔交易会改为并入修车店每月的合并电子发票。",
    ms: "Nama, nombor ID dan alamat (serta TIN bagi syarikat, pasport atau ID tentera) diperlukan untuk e-Invois individu. Jika tidak diberikan, jualan ini akan dilaporkan dalam e-Invois disatukan bulanan bengkel.",
  },
  pdpaRetention: {
    en: "Retention: kept with the workshop's tax records for the 7 years required by tax law.",
    zh: "保存期限：依税务法律规定，随修车店的税务记录保存 7 年。",
    ms: "Tempoh simpanan: disimpan bersama rekod cukai bengkel selama 7 tahun seperti yang dikehendaki undang-undang cukai.",
  },
  pdpaAccess: {
    en: "To see or correct your details, or for any question, contact {shop}.",
    zh: "如需查看或更正你的资料，或有任何疑问，请联系 {shop}。",
    ms: "Untuk melihat atau membetulkan maklumat anda, atau sebarang pertanyaan, hubungi {shop}.",
  },
  consent: {
    en: "I have read this notice and agree to {shop} using my details to issue my e-Invoice.",
    zh: "我已阅读以上通知，并同意 {shop} 使用我的资料开具我的电子发票。",
    ms: "Saya telah membaca notis ini dan bersetuju {shop} menggunakan maklumat saya untuk mengeluarkan e-Invois saya.",
  },
  consentRequired: { en: "Please tick the box to agree before sending.", zh: "请先勾选同意，再提交。", ms: "Sila tandakan kotak persetujuan sebelum menghantar." },
};

// Lock reasons the server can answer with (409); anything else reads as "already issued".
const LOCK_TEXT: Record<string, string> = {
  no_invoice: "notFound", submitted: "submitted", consolidated: "consolidated", staff_saved: "staff_saved", expired: "expired",
};

type Props = {
  token: string;
  found: boolean;
  lock: BuyerRequestLock;
  /** Last day the customer may send or correct details (Malaysia time, already formatted). */
  deadline: string;
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
  // split/join rather than replaceAll: customers' phones may run older browsers.
  const t = (k: string) => (T[k]?.[lang] ?? k).split("{shop}").join(p.shopName).split("{date}").join(p.deadline);
  const [f, setF] = useState({
    name: "", tin: "", idType: "NRIC", idNo: "", email: "", phone: "", address: "", postcode: "", city: "", stateCode: "",
  });
  const [consent, setConsent] = useState(false);
  const [bad, setBad] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);
  // A lock the server reported after the page was opened (e.g. staff saved the buyer meanwhile).
  const [lateLock, setLateLock] = useState("");

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  /** Why a field was refused, in the chosen language. */
  function fieldMsg(k: string, code: string | undefined) {
    if (!code) return "";
    if (code === "too_long") return t("tooLong").replace("{n}", String(BUYER_LIMITS[k as keyof typeof BUYER_LIMITS] ?? ""));
    if (code === "required") return t(k === "consent" ? "consentRequired" : k === "tin" ? "required_tin" : "required");
    return T[`bad_${k}`] ? t(`bad_${k}`) : t("invalid");
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    // Same rules as the server, so the customer sees every problem at once without a round trip.
    const local = checkBuyerFields({ ...f, consent });
    if (!local.ok) {
      setBad(local.errors);
      setMsg(t("fixFields"));
      return;
    }
    setBusy(true);
    setBad({});
    try {
      const res = await fetch(`/api/public/einvoice/${p.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, consent }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setDone(true);
      else if (res.status === 422) {
        setBad(data.fields || {});
        setMsg(t("fixFields"));
      } else if (res.status === 429) setMsg(t("tooMany"));
      else if (res.status === 409) setLateLock(LOCK_TEXT[data.error] || "submitted");
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

  if (!p.found || p.lock === "no_invoice") return <>{header}{note(t("notFound"), "red")}</>;
  if (p.lock !== "none") return <>{header}{note(t(LOCK_TEXT[p.lock] || "submitted"))}</>;
  if (lateLock) return <>{header}{note(t(lateLock))}</>;

  if (done) {
    return (
      <>
        {header}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
          <div className="mb-1 text-lg font-semibold">{t("doneTitle")}</div>
          <p className="text-sm">{t("doneBody")}</p>
          {p.deadline && <p className="mt-1 text-sm">{t("until")}</p>}
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
      {bad[k] && <div className="mt-1 text-xs text-red-700">{fieldMsg(k, bad[k])}</div>}
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
      {p.deadline && <p className="mb-3 text-sm text-slate-600">{t("until")}</p>}
      {p.alreadySent && <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("sentBefore")}</div>}

      <form onSubmit={send} className="space-y-3.5" noValidate>
        {field("name", t("name"), { auto: "name" })}
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">{t("idType")}</label>
          <select value={f.idType} onChange={set("idType")} className={inputCls(!!bad.idType)}>
            {["NRIC", "PASSPORT", "BRN", "ARMY"].map((k) => (
              <option key={k} value={k}>{t(k)}</option>
            ))}
          </select>
          {bad.idType && <div className="mt-1 text-xs text-red-700">{fieldMsg("idType", bad.idType)}</div>}
        </div>
        {field("idNo", t("idNo"), { help: f.idType === "NRIC" ? t("idNoHelp") : undefined, inputMode: f.idType === "NRIC" ? "numeric" : "text" })}
        {/* A Malaysian individual (IC) may leave the TIN blank; everyone else must give it. */}
        {field("tin", f.idType === "NRIC" ? t("tinOptional") : t("tin"), { help: f.idType === "NRIC" ? t("tinOptionalHelp") : t("tinHelp") })}
        <p className="-mt-1 text-xs text-emerald-700">{t("msicNotRequired")}</p>
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
          {bad.stateCode && <div className="mt-1 text-xs text-red-700">{fieldMsg("stateCode", bad.stateCode)}</div>}
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
          <div className="mb-1 text-sm font-semibold text-slate-800">{t("pdpaTitle")}</div>
          <p>{t("pdpaWho")}</p>
          <p className="mt-1">{t("pdpaPurpose")}</p>
          <p className="mt-1">{t("pdpaOptional")}</p>
          <p className="mt-1">{t("pdpaRetention")}</p>
          <p className="mt-1">
            {t("pdpaAccess")}
            {p.shopPhone && <span className="font-medium"> Tel: {p.shopPhone}</span>}
          </p>
        </div>
        <label className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${bad.consent ? "border-red-400 bg-red-50" : "border-slate-300 bg-white"}`}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          <span>{t("consent")}</span>
        </label>
        {bad.consent && <div className="-mt-2 text-xs text-red-700">{fieldMsg("consent", bad.consent)}</div>}

        {msg && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-blue-700 py-3 text-base font-semibold text-white disabled:opacity-60">
          {busy ? t("sending") : t("submit")}
        </button>
      </form>
    </>
  );
}

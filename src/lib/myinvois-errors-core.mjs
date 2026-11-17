// Turn LHDN / MyInvois API errors into short messages staff can act on (pure, testable).
// The field LHDN complains about is read from its property path (and error code) first, so a
// phone / address / email / shop-detail error is no longer reported as a "TIN problem": the old
// keyword check matched "tin" inside "AccountingSupplierParty" / "AccountingCustomerParty".
// 【中文】把 LHDN 的错误翻成店员看得懂的话：先按 LHDN 给的栏位路径（propertyPath）和错误代码判断是哪个栏位、
// 店铺还是买家，不再把电话 / 地址 / Email / 店铺资料的错误都说成 TIN 问题。

const cut = (s, n = 240) => (s.length > n ? s.slice(0, n) + "…" : s);

function rawText(detail) {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : "");
const CODE_RE = /\b([A-Z]{2}\d{3})\b/;

/**
 * Pull { code, message, path } items out of an LHDN error: a rejected submission
 * ({ error: { code, message, propertyPath, details: [...] } }), document validation results
 * ({ errorCode, error, propertyPath, innerError: [...] }) or the one-line reason the status
 * check returns ("Enter valid phone number (Invoice.AccountingSupplierParty...); ...").
 * @param {unknown} detail
 * @returns {Array<{ code: string, message: string, path: string }>}
 */
export function lhdnProblems(detail) {
  const out = [];
  const seen = new Set();
  const push = (code, message, path) => {
    if (!code && !message && !path) return;
    if (!code) code = (CODE_RE.exec(message) || [])[1] || "";
    const key = `${code}|${message}|${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ code, message, path });
  };
  const fromLine = (line) => {
    for (const part of line.split(/;\s+/)) {
      const p = part.trim();
      if (!p) continue;
      const m = /^(.*?)\s*\(([^()]+)\)$/.exec(p);
      // "(...)" at the end is the property path when it looks like one ("Invoice.X.Y").
      if (m && /^[A-Za-z][^()\s]*\.[^()\s]+$/.test(m[2].trim())) push("", m[1].trim(), m[2].trim());
      else push("", p, "");
    }
  };
  const walk = (v, depth) => {
    if (v == null || depth > 8) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if (typeof v !== "object") return;
    const message = str(v.message) || str(v.error) || str(v.error_description);
    const path = str(v.propertyPath) || str(v.propertyName) || str(v.target);
    push(str(v.errorCode) || (typeof v.code === "string" ? v.code : ""), message, path);
    for (const k of ["error", "details", "innerError", "validationResults", "validationSteps", "rejectedDocuments", "errors"]) {
      if (v[k] && typeof v[k] === "object") walk(v[k], depth + 1);
    }
  };
  if (typeof detail === "string") {
    const s = detail.trim();
    if (s.startsWith("{") || s.startsWith("[")) {
      try {
        walk(JSON.parse(s), 0);
        return out;
      } catch {
        // not JSON: read it as a reason line
      }
    }
    fromLine(s);
  } else {
    walk(detail, 0);
  }
  return out;
}

// Which field, from LHDN's property path (most reliable). Order matters.
const PATH_TOPICS = [
  ["signature", /UBLExtensions|\bSignature/i],
  ["phone", /Telephone/i],
  ["email", /ElectronicMail/i],
  ["address", /PostalAddress|AddressLine|CityName|PostalZone|CountrySubentity|\.Country\b/i],
  ["msic", /IndustryClassificationCode/i],
  ["name", /PartyName|RegistrationName/i],
  ["id", /PartyIdentification|PartyLegalEntity|CompanyID|\bTIN\b|schemeID/i],
  ["classification", /CommodityClassification|ItemClassificationCode/i],
  ["date", /IssueDate|IssueTime/i],
  ["totals", /TaxTotal|TaxSubtotal|LegalMonetaryTotal|Amount\b/i],
];

// LHDN codes this project has met for certain (see myinvois-phone.mjs).
const CODE_TOPICS = { CF408: "phone", CF409: "phone", CF410: "phone" };

// Fallback: words in the message, matched as whole words ("tin" inside "Accounting" no longer counts).
const MESSAGE_TOPICS = [
  ["signature", /signatur|unsigned|certificate|xades|digital.?sign|not.?signed/i],
  ["phone", /\b(tele)?phone\b|\bcontact number\b|\btel\b/i],
  ["email", /\be-?mail\b/i],
  ["address", /\baddress\b|\bpost(al)?\s?code\b|\bcity\b|\bstate code\b/i],
  ["msic", /\bmsic\b|industry classification/i],
  ["id", /\btin\b|\btaxpayer\b|\bnric\b|\bbrn\b|\bpassport\b|identification (number|type|value)|registration number|\bid (type|number|value)\b/i],
  ["totals", /\btotals?\b|\bamounts?\b|\bpayable\b|mismatch|does not match/i],
];

/**
 * The field and party an LHDN error is about.
 * @param {{ code: string, message: string, path: string }} p
 * @returns {{ topic: string | null, party: "supplier" | "buyer" | null }}
 */
export function classifyProblem(p) {
  const path = p.path || "";
  const msg = p.message || "";
  let topic = null;
  for (const [t, re] of PATH_TOPICS) if (re.test(path)) { topic = t; break; }
  if (!topic && CODE_TOPICS[p.code]) topic = CODE_TOPICS[p.code];
  if (!topic) for (const [t, re] of MESSAGE_TOPICS) if (re.test(msg)) { topic = t; break; }
  const both = `${path} ${msg}`;
  const party = /AccountingSupplierParty|\b(supplier|seller|issuer)\b/i.test(both)
    ? "supplier"
    : /AccountingCustomerParty|\b(buyer|customer|receiver)\b/i.test(both)
      ? "buyer"
      : null;
  return { topic, party };
}

// [English, 中文] per topic and party. "Settings → Basic Info" / "Tax / e-Invoice" are the real tab names.
const TOPIC_TEXT = {
  phone: {
    supplier: ["LHDN rejected the shop phone number. Fix it in Settings → Basic Info (e.g. 03-1234 5678), then submit again.", "LHDN 不接受店铺电话号码。请在 设置 → 基本资料 更正（例如 03-1234 5678）后再提交。"],
    buyer: ["LHDN rejected the buyer's phone number. Correct it in the buyer details on the invoice page (e.g. 012-345 6789), then submit again.", "LHDN 不接受买家电话号码。请在发票页的买家资料中更正（例如 012-345 6789）后再提交。"],
    any: ["LHDN rejected a phone number. Check the shop phone in Settings → Basic Info and the buyer's phone on the invoice page.", "LHDN 不接受电话号码。请检查 设置 → 基本资料 的店铺电话，以及发票页的买家电话。"],
  },
  email: {
    supplier: ["LHDN rejected the shop email address. Fix it in Settings → Basic Info.", "LHDN 不接受店铺 Email。请在 设置 → 基本资料 更正。"],
    buyer: ["LHDN rejected the buyer's email address. Correct or remove it in the buyer details.", "LHDN 不接受买家 Email。请在买家资料中更正或删除。"],
    any: ["LHDN rejected an email address. Check the shop email in Settings → Basic Info and the buyer's email.", "LHDN 不接受 Email 地址。请检查 设置 → 基本资料 的店铺 Email 及买家 Email。"],
  },
  address: {
    supplier: ["The shop address is incomplete or too long (street, postcode, city or state). Fix it in Settings → Basic Info.", "店铺地址不完整或太长（街道、邮编、城市或州属）。请在 设置 → 基本资料 更正。"],
    buyer: ["The buyer's address is incomplete or too long (street, postcode, city or state). Correct it in the buyer details.", "买家地址不完整或太长（街道、邮编、城市或州属）。请在买家资料中更正。"],
    any: ["An address is incomplete or too long (street, postcode, city or state). Check Settings → Basic Info and the buyer details.", "地址不完整或太长（街道、邮编、城市或州属）。请检查 设置 → 基本资料 及买家资料。"],
  },
  msic: {
    any: ["The shop MSIC code / business activity was rejected. Pick it again in Settings → Tax / e-Invoice.", "店铺 MSIC 行业代码 / 业务描述不被接受。请在 设置 → 税务 / 电子发票 重新选择。"],
  },
  name: {
    supplier: ["The shop name was rejected. Check it in Settings → Basic Info.", "店铺名称不被接受。请在 设置 → 基本资料 检查。"],
    buyer: ["The buyer's name was rejected. Check it in the buyer details.", "买家名称不被接受。请在买家资料中检查。"],
    any: ["A shop or buyer name was rejected. Check Settings → Basic Info and the buyer details.", "店铺或买家名称不被接受。请检查 设置 → 基本资料 及买家资料。"],
  },
  id: {
    supplier: ["The shop TIN / registration number (BRN, SST) was rejected. Check Settings → Tax / e-Invoice.", "店铺 TIN / 注册号（BRN、SST）不被接受。请检查 设置 → 税务 / 电子发票。"],
    buyer: ["The buyer's TIN or ID number was rejected. Check the buyer details (TIN and NRIC / BRN / passport).", "买家 TIN 或证件号码不被接受。请检查买家资料（TIN 与 IC / BRN / 护照）。"],
    any: ["Buyer or supplier TIN / ID is missing or invalid. Check Settings → Tax / e-Invoice (shop TIN) and the customer e-Invoice details.", "买家或店铺 TIN/证件缺失或无效。请检查 设置 → 税务 / 电子发票 的店铺 TIN，以及顾客 e-Invoice 资料。"],
  },
  classification: {
    any: ["An item classification code was rejected. Contact support with the details below.", "商品分类代码不被接受。请把下方详细信息发给技术支持。"],
  },
  date: {
    any: ["The issue date / time was rejected. LHDN only accepts documents issued in the last 72 hours; check the PC clock and submit again.", "开单日期 / 时间不被接受。LHDN 只接受 72 小时内开出的单据；请检查电脑时间后再提交。"],
  },
  totals: {
    any: ["Document totals do not match what LHDN expects. Re-open the invoice and check line amounts, discount and SST.", "单据金额与 LHDN 校验不一致。请重新打开发票检查明细、折扣与 SST。"],
  },
  signature: {
    any: [
      "LHDN rejected the document (signature). Production often requires a Malaysian digital certificate. This app does not sign documents yet — use Sandbox for testing, or sign externally before going live.",
      "LHDN 因签名问题拒绝了单据。正式环境通常需要马来西亚数字证书；本程序尚未内置签名。请先用沙盒测试，或另行签名后再上正式环境。",
    ],
  },
};

/**
 * Map submit / status / tin failures to human-readable text.
 * @param {unknown} detail
 * @param {{ httpStatus?: number, fallback?: string, kind?: "submit" | "status" | "tin" | "generic" }} [opts]
 * @returns {{ message: string, messageZh: string, hint?: string, raw?: string, topic?: string, party?: string | null }}
 */
// 【中文】把提交 / 查询状态 / 查 TIN 的错误翻成看得懂的提示。
export function friendlyMyInvoisError(detail, opts) {
  const raw = rawText(detail);
  const blob = (raw + " " + (opts?.fallback || "")).toLowerCase();
  const status = opts?.httpStatus || 0;

  if (status === 429 || /rate limit|too many|throttl/.test(blob)) {
    return { message: "Too many requests to LHDN. Wait about a minute and try again.", messageZh: "LHDN 请求过于频繁，请约一分钟后再试。", raw: cut(raw) };
  }

  if (/signatur|unsigned|certificate|xades|digital.?sign|not.?signed/.test(blob)) {
    const t = TOPIC_TEXT.signature.any;
    return { message: t[0], messageZh: t[1], hint: "Settings → Tax / e-Invoice explains the current limitation.", raw: cut(raw), topic: "signature", party: null };
  }

  if (opts?.kind === "tin" && /\btin\b|taxpayer|invalid.?id|\bnric\b|identification/.test(blob)) {
    return { message: "No TIN found for this ID, or the name/ID does not match LHDN records.", messageZh: "按此证件未查到 TIN，或姓名/证件与 LHDN 登记不一致。", raw: cut(raw) };
  }

  // Login failure only from the HTTP status or OAuth wording: a bare "401" in the text is often an
  // amount or line number in LHDN's reason ("Total Payable Amount 401.00 does not match").
  // 【中文】只按 HTTP 401 或 OAuth 错误字眼判断登录失败；文字里的 "401" 常是金额或行号，不能当作登录失败。
  if (status === 401 || /unauthori[sz]ed|invalid.?client|access.?denied/.test(blob)) {
    return { message: "MyInvois login failed. Check Client ID / Secret in Settings, and Sandbox vs Production.", messageZh: "MyInvois 登录失败。请检查设置中的 Client ID/Secret，以及沙盒/正式环境开关。", raw: cut(raw) };
  }

  if (/duplicate|already.?exist|unique|code.?number.?already|\bds302\b/.test(blob)) {
    return { message: "This invoice number may already exist at LHDN. Do not submit the same number twice.", messageZh: "该发票号码可能已在 LHDN 存在，请勿重复提交同一号码。", raw: cut(raw) };
  }

  // The field LHDN complains about: first problem that can be placed wins.
  for (const p of lhdnProblems(detail)) {
    const { topic, party } = classifyProblem(p);
    if (!topic) continue;
    const t = TOPIC_TEXT[topic];
    const [message, messageZh] = (party && t[party]) || t.any;
    return {
      message,
      messageZh,
      ...(topic === "signature" ? { hint: "Settings → Tax / e-Invoice explains the current limitation." } : {}),
      raw: cut(raw),
      topic,
      party,
    };
  }

  // Same for "not found": the HTTP status or the words, never a bare "404" in the text.
  if (status === 404 || /\bnot.?found\b/.test(blob)) {
    return {
      message: opts?.kind === "tin" ? "No taxpayer found for this ID." : "LHDN could not find this submission or document.",
      messageZh: opts?.kind === "tin" ? "查无此证件对应的纳税人。" : "LHDN 找不到该提交或单据。",
      raw: cut(raw),
    };
  }

  if (opts?.fallback) return { message: opts.fallback, messageZh: opts.fallback, raw: cut(raw) || undefined };
  if (raw) return { message: "LHDN returned an error. See details if needed.", messageZh: "LHDN 返回错误，必要时查看详细信息。", raw: cut(raw) };
  return { message: "Request to LHDN failed.", messageZh: "请求 LHDN 失败。" };
}

/**
 * Single line for UI toast / inline message (English primary + optional zh).
 * @param {{ message: string, messageZh?: string, hint?: string }} fe
 * @param {boolean} [bilingual]
 */
export function formatFriendlyError(fe, bilingual = true) {
  let s = fe.message;
  if (bilingual && fe.messageZh && fe.messageZh !== fe.message) s += " / " + fe.messageZh;
  if (fe.hint) s += " — " + fe.hint;
  return s;
}

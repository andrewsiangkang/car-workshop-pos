/**
 * Turn LHDN / MyInvois API errors into short messages staff can act on.
 * Keeps a truncated raw detail for debugging.
 */

export type FriendlyError = {
  message: string;
  messageZh: string;
  hint?: string;
  raw?: string;
};

function rawText(detail: unknown): string {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

function lower(s: string) {
  return s.toLowerCase();
}

/**
 * Map submit / status / tin failures to human-readable text.
 * `kind` is a coarse source so callers can add context.
 */
export function friendlyMyInvoisError(
  detail: unknown,
  opts?: { httpStatus?: number; fallback?: string; kind?: "submit" | "status" | "tin" | "generic" }
): FriendlyError {
  const raw = rawText(detail);
  const blob = lower(raw + " " + (opts?.fallback || ""));
  const status = opts?.httpStatus || 0;

  const cut = (s: string, n = 240) => (s.length > n ? s.slice(0, n) + "…" : s);

  if (status === 429 || /rate limit|too many|throttl/.test(blob)) {
    return {
      message: "Too many requests to LHDN. Wait about a minute and try again.",
      messageZh: "LHDN 请求过于频繁，请约一分钟后再试。",
      raw: cut(raw),
    };
  }

  if (/signatur|unsigned|certificate|xades|digital.?sign|not.?signed/.test(blob)) {
    return {
      message:
        "LHDN rejected the document (signature). Production often requires a Malaysian digital certificate. This app does not sign documents yet — use Sandbox for testing, or sign externally before going live.",
      messageZh:
        "LHDN 因签名问题拒绝了单据。正式环境通常需要马来西亚数字证书；本程序尚未内置签名。请先用沙盒测试，或另行签名后再上正式环境。",
      hint: "Settings → MyInvois explains the current limitation.",
      raw: cut(raw),
    };
  }

  if (/duplicate|already.?exist|unique|code.?number.?already/.test(blob)) {
    return {
      message: "This invoice number may already exist at LHDN. Do not submit the same number twice.",
      messageZh: "该发票号码可能已在 LHDN 存在，请勿重复提交同一号码。",
      raw: cut(raw),
    };
  }

  if (/tin|taxpayer|invalid.?id|nric|identification/.test(blob) && opts?.kind === "tin") {
    return {
      message: "No TIN found for this ID, or the name/ID does not match LHDN records.",
      messageZh: "按此证件未查到 TIN，或姓名/证件与 LHDN 登记不一致。",
      raw: cut(raw),
    };
  }

  if (/tin|buyer|supplier|party.?identification|mandatory.*tin/.test(blob)) {
    return {
      message: "Buyer or supplier TIN / ID is missing or invalid. Check Settings (shop TIN) and the customer e-Invoice details.",
      messageZh: "买家或店铺 TIN/证件缺失或无效。请检查设置中的店铺 TIN，以及顾客 e-Invoice 资料。",
      raw: cut(raw),
    };
  }

  if (/address|postcode|postal.?code|state|city|line.?1/.test(blob)) {
    return {
      message: "Address is incomplete (street, postcode, city or state). Fill shop address in Settings and buyer address if required.",
      messageZh: "地址不完整（街道、邮编、城市或州属）。请在设置中补全店铺地址，必要时补全买家地址。",
      raw: cut(raw),
    };
  }

  if (/total|amount|payable|mismatch|does not match/.test(blob)) {
    return {
      message: "Document totals do not match what LHDN expects. Re-open the invoice and check line amounts, discount and SST.",
      messageZh: "单据金额与 LHDN 校验不一致。请重新打开发票检查明细、折扣与 SST。",
      raw: cut(raw),
    };
  }

  if (/unauthorized|invalid.?client|invalid_client|access.?denied|401/.test(blob) || status === 401) {
    return {
      message: "MyInvois login failed. Check Client ID / Secret in Settings, and Sandbox vs Production.",
      messageZh: "MyInvois 登录失败。请检查设置中的 Client ID/Secret，以及沙盒/正式环境开关。",
      raw: cut(raw),
    };
  }

  if (/not.?found|404/.test(blob) || status === 404) {
    return {
      message: opts?.kind === "tin"
        ? "No taxpayer found for this ID."
        : "LHDN could not find this submission or document.",
      messageZh: opts?.kind === "tin" ? "查无此证件对应的纳税人。" : "LHDN 找不到该提交或单据。",
      raw: cut(raw),
    };
  }

  if (opts?.fallback) {
    return {
      message: opts.fallback,
      messageZh: opts.fallback,
      raw: cut(raw) || undefined,
    };
  }

  if (raw) {
    return {
      message: "LHDN returned an error. See details if needed.",
      messageZh: "LHDN 返回错误，必要时查看详细信息。",
      raw: cut(raw),
    };
  }

  return {
    message: "Request to LHDN failed.",
    messageZh: "请求 LHDN 失败。",
  };
}

/** Single line for UI toast / inline message (English primary + optional zh). */
export function formatFriendlyError(fe: FriendlyError, bilingual = true): string {
  let s = fe.message;
  if (bilingual && fe.messageZh && fe.messageZh !== fe.message) {
    s += " / " + fe.messageZh;
  }
  if (fe.hint) s += " — " + fe.hint;
  return s;
}

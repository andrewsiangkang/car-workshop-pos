// WhatsApp service reminders (pure): who may be sent one (PDPA consent / opt-out), in which
// language, and the message text in English, Chinese and Malay.
// 【中文】WhatsApp 保养提醒的纯规则：谁可以发送（PDPA 同意 / 退订）、用什么语言，以及中英马三种语言的提醒文字。
import { customerPhoneKey } from "./customer-match.mjs";

/**
 * Whether a reminder may be offered for this customer, and why not:
 * ANONYMISED, OPTED_OUT, NO_CONSENT or NO_PHONE.
 * 【中文】这位客户能不能发提醒，不能的原因：已匿名化、已退订、没有同意记录、没有可用的电话。
 * @param {{ phone?: string | null, reminderConsentAt?: unknown, reminderOptOutAt?: unknown, anonymisedAt?: unknown }} c
 * @returns {{ ok: true } | { ok: false, reason: "ANONYMISED" | "OPTED_OUT" | "NO_CONSENT" | "NO_PHONE" }}
 */
export function reminderEligibility(c) {
  if (c.anonymisedAt) return { ok: false, reason: "ANONYMISED" };
  if (c.reminderOptOutAt) return { ok: false, reason: "OPTED_OUT" };
  if (!c.reminderConsentAt) return { ok: false, reason: "NO_CONSENT" };
  if (!whatsappNumber(c.phone)) return { ok: false, reason: "NO_PHONE" };
  return { ok: true };
}

/**
 * wa.me number: digits only, Malaysian "0…" numbers get the 60 country code. "" when not usable.
 * @param {unknown} phone
 */
export function whatsappNumber(phone) {
  const key = customerPhoneKey(phone);
  if (!key) return "";
  let n = key.replace(/\D/g, "");
  if (!key.startsWith("+") && n.startsWith("0")) n = "60" + n.slice(1);
  return n.length >= 9 && n.length <= 15 ? n : "";
}

/**
 * Names that are not a real person's name: blank, walk-in records ("Walk-in (WXY1234)"),
 * placeholders, an anonymised record, or just the car plate. Such a name is never used in a greeting.
 * 【中文】不是真实姓名的名字（散客、占位符、已匿名、只是车牌）：问候语里不使用。
 * @param {unknown} name
 * @param {unknown} [plate]
 */
export function isPlaceholderName(name, plate) {
  const n = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!n) return true;
  if (/^walk[\s-]?in\b/i.test(n)) return true;
  if (/^(n\/?a|nil|none|-+|tba|unknown|customer|cash|cash customer|general public|anonymi[sz]ed customer)$/i.test(n)) return true;
  const squash = (/** @type {unknown} */ v) => String(v ?? "").replace(/[\s-]+/g, "").toUpperCase();
  return !!plate && squash(n) === squash(plate);
}

/**
 * Reminder language: the customer's own choice, else the shop's (Settings locale "zh-MY" → zh,
 * "ms-MY" → ms), else English.
 * @param {unknown} customerLanguage
 * @param {unknown} shopLocale
 * @returns {"en" | "zh" | "ms"}
 */
export function reminderLanguage(customerLanguage, shopLocale) {
  if (customerLanguage === "en" || customerLanguage === "zh" || customerLanguage === "ms") return customerLanguage;
  const loc = String(shopLocale ?? "").toLowerCase();
  if (loc.startsWith("zh")) return "zh";
  if (loc.startsWith("ms")) return "ms";
  return "en";
}

/**
 * @param {{ language: "en" | "zh" | "ms", name?: string | null, plate: string, make?: string | null, model?: string | null,
 *   dueDate?: string | null, dueKm?: number | null, shopName?: string | null }} p
 *   dueDate is already formatted for display (e.g. "14/11/2026").
 * @returns {string}
 */
export function reminderMessage({ language, name, plate, make, model, dueDate, dueKm, shopName }) {
  const realName = isPlaceholderName(name, plate) ? "" : String(name).replace(/\s+/g, " ").trim();
  const car = [make, model].map((v) => String(v ?? "").trim()).filter((v) => v && v.toLowerCase() !== "unknown").join(" ");
  const km = dueKm != null && Number.isFinite(Number(dueKm)) ? Number(dueKm).toLocaleString("en-MY") : "";
  const shop = String(shopName ?? "").trim();
  if (language === "zh") {
    const hi = realName ? `${realName}，您好！` : `您好！`;
    const from = shop ? `这是 ${shop} 的保养提醒。` : "这是我们车厂的保养提醒。";
    const due = [dueDate ? `日期 ${dueDate}` : "", km ? `${km} 公里` : ""].filter(Boolean).join(" / ");
    return `${hi}${from}您的车 ${plate}${car ? `（${car}）` : ""}${due ? `大约在 ${due} ` : ""}需要做下一次保养。请联系我们预约时间，谢谢！如不想再收到提醒，请回复 STOP。`;
  }
  if (language === "ms") {
    const hi = realName ? `Salam ${realName},` : "Salam sejahtera,";
    const from = shop ? `ini peringatan daripada ${shop}.` : "ini peringatan daripada bengkel kami.";
    const due = [dueDate ? `tarikh ${dueDate}` : "", km ? `${km} km` : ""].filter(Boolean).join(" / ");
    return `${hi} ${from} Kenderaan ${plate}${car ? ` (${car})` : ""} anda perlu diservis${due ? ` sekitar ${due}` : ""}. Sila hubungi kami untuk membuat temu janji. Terima kasih. Balas STOP jika tidak mahu menerima peringatan lagi.`;
  }
  const hi = realName ? `Hi ${realName},` : "Hello,";
  const from = shop ? `this is a reminder from ${shop}.` : "this is a reminder from our workshop.";
  const due = [dueDate ? `date ${dueDate}` : "", km ? `${km} km` : ""].filter(Boolean).join(" / ");
  return `${hi} ${from} Your ${plate}${car ? ` (${car})` : ""} is due for its next service${due ? ` around ${due}` : ""}. Please contact us to arrange a visit. Thank you. Reply STOP if you no longer want these reminders.`;
}

/**
 * Full wa.me link, or "" when this customer may not be messaged (see reminderEligibility).
 * @param {Parameters<typeof reminderEligibility>[0]} customer
 * @param {Parameters<typeof reminderMessage>[0]} message
 */
export function reminderLink(customer, message) {
  if (!reminderEligibility(customer).ok) return "";
  return `https://wa.me/${whatsappNumber(customer.phone)}?text=${encodeURIComponent(reminderMessage(message))}`;
}

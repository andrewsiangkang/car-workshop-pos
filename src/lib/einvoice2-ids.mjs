// Identification numbers on an LHDN e-Invoice (review Medium, myinvois.ts:253,275):
// - is a 12-digit number a MyKad (NRIC) or a new-format SSM registration number (BRN)?
// - is a buyer's ID number valid for its type (NRIC / BRN / PASSPORT / ARMY)?
// - which TIN and second ID are sent for the buyer: their own TIN, LHDN's general TIN for a
//   Malaysian individual who gave no TIN (with the MyKad number), or General Public.
// Pure functions, no imports: used by myinvois.ts, the QR form, the staff buyer form and tests.
// 【中文】电子发票上的证件号码：分辨 12 位数字是身份证（MyKad）还是 SSM 新格式注册号；按证件类型检查买方证件号码；
// 决定送给 LHDN 的买方 TIN + 证件：自己的 TIN / 没填 TIN 的马来西亚个人（用 LHDN 个人通用 TIN + 身份证号）/ General Public。

/** LHDN's general TIN: General Public, and Malaysian individuals who do not give a TIN. */
export const GENERAL_PUBLIC_TIN = "EI00000000010";

/** LHDN's shared TINs (general public / individuals, foreign buyer, foreign supplier, government). */
const SHARED_TIN = /^EI0{9}[1-9]0$/;

export const ID_TYPES = Object.freeze(["NRIC", "PASSPORT", "BRN", "ARMY"]);

const clean = (v) => String(v ?? "").toUpperCase().replace(/[\s-]/g, "");

/**
 * MyKad place-of-birth code (JPN): states 01-16 and 21-59; born abroad / unknown 60-68, 71-72,
 * 74-79, 82-93, 98-99. Codes such as 00, 17-20, 69-70, 73, 80-81 and 94-97 are never issued.
 * @param {string} pb two digits
 */
function validPlaceCode(pb) {
  const n = Number(pb);
  return (
    (n >= 1 && n <= 16) || (n >= 21 && n <= 68) || n === 71 || n === 72 ||
    (n >= 74 && n <= 79) || (n >= 82 && n <= 93) || n === 98 || n === 99
  );
}

/**
 * A MyKad number: YYMMDD (a real date) + place-of-birth code + 4 digits. Dashes / spaces ignored.
 * @param {unknown} v
 */
// 【中文】身份证号码：前 6 位是出生日期（必须是真实日期），7-8 位是出生地代码，最后 4 位数字。
export function isMyKadNumber(v) {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})\d{4}$/.exec(clean(v));
  if (!m) return false;
  const yy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1) return false;
  const days = [31, yy % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1];
  return dd <= days && validPlaceCode(m[4]);
}

/**
 * A new-format SSM registration number (used since 2019, also given to older entities): year of
 * registration + entity type (01 local company, 02 foreign company, 03 business, 04-06 LLP) +
 * 6 digits, e.g. 202001012345. Such a number can also look like a MyKad (birth years 1919/1920
 * or 2019/2020 only), so an SSM-looking number is never sent as an NRIC.
 * @param {unknown} v
 * @param {Date} [now]
 */
// 【中文】SSM 新格式注册号：注册年份 + 实体类别（01-06）+ 6 位数字，例如 202001012345。
export function isSsmRegistrationNumber(v, now = new Date()) {
  const m = /^((?:19|20)\d{2})(0[1-6])\d{6}$/.exec(clean(v));
  return !!m && Number(m[1]) <= now.getUTCFullYear() + 1;
}

/**
 * The seller's second ID next to its TIN. An individual taxpayer (TIN starting with "IG") whose
 * number is a real MyKad, and not an SSM registration number, is identified by NRIC; everything
 * else is a BRN (a 12-digit SSM number used to be sent as an NRIC).
 * @param {string | null | undefined} tin
 * @param {string | null | undefined} brn the "BRN" box in Settings
 * @returns {{ scheme: "NRIC" | "BRN", value: string }}
 */
// 【中文】卖方 TIN 旁边的第二个证件：个人纳税人（IG 开头）且号码是真的身份证、又不是 SSM 注册号时用 NRIC；其他都是 BRN。
export function supplierSecondId(tin, brn) {
  const typed = String(brn ?? "").trim();
  const value = clean(typed);
  if (!value || value === "NA") return { scheme: "BRN", value: "NA" };
  const individual = /^IG/i.test(String(tin ?? "").trim());
  if (individual && isMyKadNumber(value) && !isSsmRegistrationNumber(value)) return { scheme: "NRIC", value };
  // A BRN is sent as typed (old SSM numbers keep their letter, e.g. 1234567-A).
  return { scheme: "BRN", value: typed };
}

/**
 * Is a buyer ID number valid for its type? null when fine, else "required" | "invalid".
 * - NRIC: a real MyKad number (birth date + place code).
 * - BRN: a new-format SSM number (12 digits, see isSsmRegistrationNumber) or an older one
 *   (letters and digits, e.g. 1234567A). A 12-digit number that is not an SSM number (often an IC
 *   typed as BRN) is refused.
 * - PASSPORT / ARMY: 5 to 20 letters or numbers.
 * @param {unknown} idType
 * @param {unknown} idNo
 * @returns {null | "required" | "invalid"}
 */
// 【中文】按证件类型检查买方证件号码：身份证要是真实的 MyKad；BRN 是 SSM 号码（12 位新格式或旧格式）；护照 / 军人证 5-20 个字母或数字。
export function checkBuyerId(idType, idNo) {
  const type = clean(idType);
  const no = clean(idNo);
  if (!ID_TYPES.includes(type)) return "invalid";
  if (!no) return "required";
  if (type === "NRIC") return isMyKadNumber(no) ? null : "invalid";
  if (!/^[A-Z0-9]{5,20}$/.test(no)) return "invalid";
  if (type === "BRN" && /^\d{12}$/.test(no) && !isSsmRegistrationNumber(no)) return "invalid";
  return null;
}

const ID_LABEL = { NRIC: "NRIC (IC)", BRN: "BRN (SSM)", PASSPORT: "passport", ARMY: "army ID" };

/**
 * Show only the last 4 characters of an ID number (audit log, messages).
 * @param {unknown} v
 */
export function maskId(v) {
  const s = clean(v);
  if (!s) return "";
  return s.length <= 4 ? "*".repeat(s.length) : "*".repeat(s.length - 4) + s.slice(-4);
}

/**
 * The TIN and second ID sent for the buyer, or what staff must fix first.
 * - A TIN (own, or one of LHDN's shared TINs) with an ID number: sent as they are, once the ID
 *   number is valid for its type.
 * - A Malaysian individual (NRIC) with no TIN: LHDN's general TIN EI00000000010 with the MyKad
 *   number (LHDN e-Invoice Specific Guideline; confirm with your tax agent).
 * - No ID number and no TIN of their own (walk-in): General Public, EI00000000010 and "NA".
 * - An own TIN without an ID number, or a BRN / passport / army ID without a TIN: refused with
 *   the field to fix (LHDN checks the TIN against the ID, so "NA" next to a real TIN fails).
 * @param {{ tin?: string | null, idType?: string | null, idNo?: string | null } | null | undefined} b
 * @returns {{ ok: true, kind: "general_public" | "individual_no_tin" | "with_tin", tin: string, idScheme: string, idValue: string } | { ok: false, field: "tin" | "idNo", message: string }}
 */
// 【中文】买方要送的 TIN 和证件：有 TIN 有证件（证件号码要合格）就照送；没填 TIN 的马来西亚个人用 EI00000000010 + 身份证号；
// 什么都没有的散客是 General Public（EI00000000010 + NA）；有自己的 TIN 却没证件、或 BRN / 护照 / 军人证没 TIN，就拒绝并说明要改哪一栏。
export function buyerParty(b) {
  // A placeholder typed in the TIN box ("N/A", "-", "000000") is no TIN at all.
  const typedTin = clean(b && b.tin);
  const tin = /^[A-Z0-9]{6,20}$/.test(typedTin) && !/^0+$/.test(typedTin) ? typedTin : "";
  const idType = clean(b && b.idType);
  const idNo = clean(b && b.idNo);
  const ownTin = !!tin && !SHARED_TIN.test(tin);
  if (!idNo) {
    if (ownTin) {
      return {
        ok: false,
        field: "idNo",
        message:
          "The buyer has a TIN but no ID number (NRIC, BRN, passport or army ID). LHDN checks the TIN against it. " +
          "Add the ID number in the buyer details on the invoice page, then try again.",
      };
    }
    return { ok: true, kind: "general_public", tin: tin || GENERAL_PUBLIC_TIN, idScheme: "BRN", idValue: "NA" };
  }
  const bad = checkBuyerId(idType, idNo);
  if (bad) {
    const label = ID_LABEL[/** @type {keyof typeof ID_LABEL} */ (idType)] || "ID";
    return {
      ok: false,
      field: "idNo",
      message:
        `The buyer's ${label} number (ending ${maskId(idNo).slice(-4)}) is not valid for that ID type. ` +
        "Correct the ID type or ID number in the buyer details on the invoice page, then try again.",
    };
  }
  if (idType === "NRIC" && (!tin || tin === GENERAL_PUBLIC_TIN)) {
    return { ok: true, kind: "individual_no_tin", tin: GENERAL_PUBLIC_TIN, idScheme: "NRIC", idValue: idNo };
  }
  if (tin) return { ok: true, kind: "with_tin", tin, idScheme: idType, idValue: idNo };
  return {
    ok: false,
    field: "tin",
    message:
      "A TIN is needed for a buyer identified by BRN, passport or army ID (only a Malaysian individual with an IC may leave it blank). " +
      "Add the TIN in the buyer details on the invoice page, then try again.",
  };
}

/**
 * Nobody named for LHDN: no ID number and no TIN of their own. "NA" is then accepted for the phone.
 * @param {{ tin?: string | null, idType?: string | null, idNo?: string | null } | null | undefined} b
 */
export function isGeneralPublicBuyer(b) {
  const p = buyerParty(b);
  return p.ok && p.kind === "general_public";
}

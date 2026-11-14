// LHDN UBL 2.1 JSON documents: invoice (01), credit note (02), refund note (04) and the monthly
// consolidated e-Invoice (01, buyer General Public). Pure (only pure modules are imported), so
// tests can check that what LHDN gets adds up to the printed totals to the sen.
// myinvois.ts re-exports these for the API routes.
// 【中文】LHDN 电子发票 JSON（UBL 2.1）：发票 01、贷项通知 02、退款单 04、每月合并电子发票。纯函数，测试可以核对送出的金额和打印的一致到仙。

import { roundMoney, toCents, fromCents } from "./money-core.mjs";
import { computeIssuedTotals } from "./tax-core.mjs";
import { isValidMyInvoisPhone, normalizeMyInvoisPhone } from "./myinvois-phone.mjs";
import { buyerParty, isGeneralPublicBuyer, supplierSecondId } from "./einvoice2-ids.mjs";

const money = (n) => roundMoney(Number(n) || 0);

/** LHDN's limit for one document, and the size we stay under (the rest is safety margin). */
export const LHDN_MAX_DOC_BYTES = 300 * 1024;
export const SAFE_DOC_BYTES = 240 * 1024;

// 022 = "Others", 004 = Consolidated e-Invoice (LHDN classification codes).
export const CLASS_OTHERS = "022";
export const CLASS_CONSOLIDATED = "004";

/** LHDN document types used here. */
export const DOC_TYPE = Object.freeze({ INVOICE: "01", CREDIT_NOTE: "02", REFUND_NOTE: "04" });

/**
 * Split an amount that has already been taxed (net + tax) into a taxed bucket and an untaxed
 * bucket. Needed when only labour was taxed (scope "LABOR") or for credit notes / consolidated
 * lines that cover part of an invoice. The bases always add up to `net`.
 * @param {number} net
 * @param {number} tax
 * @param {number} rate
 */
export function splitByTax(net, tax, rate) {
  net = money(net);
  tax = money(tax);
  if (tax <= 0 || rate <= 0) return [{ base: net, tax: 0, rate: 0 }];
  const taxedBase = Math.min(net, money((tax * 100) / rate));
  const rest = money(net - taxedBase);
  return rest > 0 ? [{ base: taxedBase, tax, rate }, { base: rest, tax: 0, rate: 0 }] : [{ base: taxedBase, tax, rate }];
}

// LHDN tax types: 02 = Service Tax, 06 = Not Applicable.
const SCHEME = [{ ID: [{ _: "OTH", schemeAgencyID: "6", schemeID: "UN/ECE 5153" }] }];
const cur = (n) => [{ _: money(n), currencyID: "MYR" }];
const subtotal = (p) => ({
  TaxableAmount: cur(p.base),
  TaxAmount: cur(p.tax),
  Percent: [{ _: p.rate > 0 ? p.rate : 0 }],
  TaxCategory: [{ ID: [{ _: p.rate > 0 ? "02" : "06" }], TaxScheme: SCHEME }],
});

const GENERAL_PUBLIC = Object.freeze({ name: "General Public", tin: null, phone: null });

/**
 * Buyer phone problem for an individual e-Invoice / credit note, or null when fine.
 * LHDN accepts "NA" for the buyer's contact number only for a general-public buyer;
 * a named buyer (own TIN, or an IC number) must have a real number (CF410).
 * @param {{ phone?: string | null, tin?: string | null, idType?: string | null, idNo?: string | null }} b
 */
// 【中文】买家电话检查：有名有姓的买家（有 TIN 或身份证号）必须有有效电话；一般公众（General Public）可以用 "NA"。
export function buyerPhoneProblem(b) {
  if (isGeneralPublicBuyer(b)) return null;
  if (isValidMyInvoisPhone(b.phone, { allowNA: false })) return null;
  return (
    "The buyer's phone number is missing or not valid. LHDN needs it on an individual e-Invoice. " +
    "Add it in the buyer details (e.g. 012-345 6789) and try again."
  );
}

/**
 * Everything about the buyer LHDN would refuse, checked before submitting: the TIN / ID pair
 * (each ID number valid for its type), then the phone. null when fine.
 * @param {{ phone?: string | null, tin?: string | null, idType?: string | null, idNo?: string | null }} b
 */
// 【中文】提交前检查买方：TIN 和证件号码（按证件类型检查格式），再检查电话。没问题返回 null。
export function buyerProblem(b) {
  const party = buyerParty(b);
  if (!party.ok) return party.message;
  return buyerPhoneProblem(b);
}

/** Telephone value sent for the buyer: a valid E.164 number, else "NA" (general public only). */
function buyerTelephone(b) {
  return isValidMyInvoisPhone(b.phone, { allowNA: false }) ? normalizeMyInvoisPhone(b.phone) : "NA";
}

/**
 * Build one UBL 2.1 JSON document. Throws when the buyer's TIN / ID cannot be sent
 * (callers check buyerProblem first and show its message).
 * @param {{ typeCode: "01" | "02" | "04", number: string, issueDate: string, issueTime: string, supplier: Record<string, any>, customer: Record<string, any>, lines: Array<{ description: string, quantity: number, unitPrice: number, gross: number, discount: number, parts: Array<{ base: number, tax: number, rate: number }>, classification: string }>, billingReference?: { number: string, uuid: string } }} p
 */
export function buildUblDocument(p) {
  const lines = p.lines.map((l, i) => {
    const net = money(l.gross - l.discount);
    const lineTax = money(l.parts.reduce((s, x) => s + x.tax, 0));
    return {
      ID: [{ _: String(i + 1) }],
      InvoicedQuantity: [{ _: l.quantity, unitCode: "C62" }],
      LineExtensionAmount: cur(net), // after discount, before tax
      ...(l.discount > 0
        ? { AllowanceCharge: [{ ChargeIndicator: [{ _: false }], AllowanceChargeReason: [{ _: "Discount" }], Amount: cur(l.discount) }] }
        : {}),
      TaxTotal: [{ TaxAmount: cur(lineTax), TaxSubtotal: l.parts.map(subtotal) }], // mandatory per line
      Item: [{
        CommodityClassification: [{ ItemClassificationCode: [{ _: l.classification, listID: "CLASS" }] }],
        Description: [{ _: String(l.description).slice(0, 300) }],
      }],
      Price: [{ PriceAmount: cur(l.unitPrice) }],
      ItemPriceExtension: [{ Amount: cur(l.gross) }],
    };
  });

  // Document tax buckets, grouped by rate (summed in sen).
  /** @type {Map<number, { base: number, tax: number, rate: number }>} */
  const buckets = new Map();
  for (const l of p.lines) for (const x of l.parts) {
    const b = buckets.get(x.rate) || { base: 0, tax: 0, rate: x.rate };
    b.base = fromCents(toCents(b.base) + toCents(x.base));
    b.tax = fromCents(toCents(b.tax) + toCents(x.tax));
    buckets.set(x.rate, b);
  }
  const net = fromCents(p.lines.reduce((s, l) => s + toCents(money(l.gross - l.discount)), 0));
  const tax = fromCents([...buckets.values()].reduce((s, b) => s + toCents(b.tax), 0));
  const total = fromCents(toCents(net) + toCents(tax));
  const sup = p.supplier;
  const cus = p.customer;
  const party = buyerParty(cus);
  if (!party.ok) throw new Error(party.message);
  const sid = supplierSecondId(sup.tin, sup.brn);

  return {
    _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    Invoice: [{
      ID: [{ _: p.number }],
      IssueDate: [{ _: p.issueDate }],
      IssueTime: [{ _: p.issueTime }],
      InvoiceTypeCode: [{ _: p.typeCode, listVersionID: "1.0" }],
      DocumentCurrencyCode: [{ _: "MYR" }],
      ...(p.billingReference
        ? { BillingReference: [{ InvoiceDocumentReference: [{ ID: [{ _: p.billingReference.number }], UUID: [{ _: p.billingReference.uuid }] }] }] }
        : {}),
      AccountingSupplierParty: [{
        Party: [{
          IndustryClassificationCode: [{ _: sup.msic, name: sup.msicDesc }],
          PartyIdentification: [
            { ID: [{ _: sup.tin, schemeID: "TIN" }] },
            // An individual taxpayer (IG TIN) identifies with the MyKad; an SSM number is always a BRN.
            { ID: [{ _: sid.value, schemeID: sid.scheme }] },
            { ID: [{ _: sup.sst, schemeID: "SST" }] },
          ],
          PartyName: [{ Name: [{ _: sup.name }] }],
          PostalAddress: [{
            CityName: [{ _: sup.city }],
            PostalZone: [{ _: sup.postcode }],
            CountrySubentityCode: [{ _: sup.stateCode }],
            AddressLine: [{ Line: [{ _: sup.address }] }],
            Country: [{ IdentificationCode: [{ _: "MYS", listID: "ISO3166-1", listAgencyID: "6" }] }],
          }],
          PartyLegalEntity: [{ RegistrationName: [{ _: sup.name }] }],
          // CF410: send a normalized international phone, never the raw Settings value.
          Contact: [{ Telephone: [{ _: normalizeMyInvoisPhone(sup.phone) }] }],
        }],
      }],
      AccountingCustomerParty: [{
        Party: [{
          PartyIdentification: [
            // Own TIN; LHDN's general TIN EI00000000010 for General Public or an individual with
            // no TIN (then with their MyKad number); never an ID that failed its format check.
            { ID: [{ _: party.tin, schemeID: "TIN" }] },
            { ID: [{ _: party.idValue, schemeID: party.idScheme }] },
          ],
          PartyName: [{ Name: [{ _: cus.name || "General Public" }] }],
          PostalAddress: [{
            CityName: [{ _: cus.city || "NA" }],
            ...(cus.postcode ? { PostalZone: [{ _: cus.postcode }] } : {}),
            CountrySubentityCode: [{ _: cus.stateCode || "17" }], // 17 = Not Applicable
            AddressLine: [{ Line: [{ _: cus.address || "NA" }] }],
            Country: [{ IdentificationCode: [{ _: "MYS", listID: "ISO3166-1", listAgencyID: "6" }] }],
          }],
          PartyLegalEntity: [{ RegistrationName: [{ _: cus.name || "General Public" }] }],
          Contact: [{
            // A named buyer's phone is checked before submitting (buyerPhoneProblem); anything
            // that is not a valid E.164 number is sent as "NA" rather than as broken text.
            Telephone: [{ _: buyerTelephone(cus) }],
            ...(cus.email ? { ElectronicMail: [{ _: cus.email }] } : {}),
          }],
        }],
      }],
      TaxTotal: [{ TaxAmount: cur(tax), TaxSubtotal: [...buckets.values()].map(subtotal) }],
      // Discounts are applied on each line, so document totals add up exactly.
      LegalMonetaryTotal: [{
        LineExtensionAmount: cur(net),
        TaxExclusiveAmount: cur(net),
        TaxInclusiveAmount: cur(total),
        PayableAmount: cur(total),
      }],
      InvoiceLine: lines,
    }],
  };
}

/** Read the payable total back out of a built document (for safety checks). */
export function payableOf(doc) {
  return doc.Invoice[0].LegalMonetaryTotal[0].PayableAmount[0]._;
}

/**
 * Totals LHDN reads from a document: before tax, tax, payable, and the sums over the lines
 * (used by tests and the safety checks).
 * @param {ReturnType<typeof buildUblDocument>} doc
 */
export function documentTotals(doc) {
  const inv = doc.Invoice[0];
  const lines = inv.InvoiceLine;
  return {
    net: inv.LegalMonetaryTotal[0].TaxExclusiveAmount[0]._,
    tax: inv.TaxTotal[0].TaxAmount[0]._,
    payable: inv.LegalMonetaryTotal[0].PayableAmount[0]._,
    lineNet: fromCents(lines.reduce((s, l) => s + toCents(l.LineExtensionAmount[0]._), 0)),
    lineTax: fromCents(lines.reduce((s, l) => s + toCents(l.TaxTotal[0].TaxAmount[0]._), 0)),
    lineCount: lines.length,
  };
}

/** Size of a document as sent to LHDN (UTF-8 bytes of its JSON). */
export function docBytes(doc) {
  return new TextEncoder().encode(JSON.stringify(doc)).length;
}

/**
 * Normal e-Invoice for one work order: same calculation as the printed invoice (computeTotals),
 * so totals match to the sen. issuedTax is the SST stored when the invoice was issued: an invoice
 * issued under v0.3.29 or earlier may differ by a sen on half-sen lines (older rounding), and is
 * then rebuilt with that version's rounding when that gives exactly the stored SST (computeIssuedTotals).
 * 【中文】单张发票的电子发票：和打印发票同一套算法。旧版本（v0.3.29 及以前）开的发票若税额差 1 分，就按旧的四舍五入方法重算明细。
 * @param {{ invoiceNumber: string, issueDate: string, issueTime: string, supplier: Record<string, any>, customer: Record<string, any>, lines: Array<{ description: string, quantity: number, unitPrice: number, total: number, type: string }>, discount: number, taxRate: number, taxScope: string, issuedTax?: number | null }} params
 */
export function buildInvoiceJson(params) {
  // Same rule as credit notes (credit-calc.mjs): rebuilt the way the invoice was issued.
  const t = computeIssuedTotals(params.lines, params.discount, params.taxRate, params.taxScope, params.issuedTax);
  return buildUblDocument({
    typeCode: DOC_TYPE.INVOICE,
    number: params.invoiceNumber,
    issueDate: params.issueDate,
    issueTime: params.issueTime,
    supplier: params.supplier,
    customer: params.customer,
    lines: params.lines.map((l, i) => {
      const c = t.lines[i];
      return {
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        gross: money(l.total),
        discount: c.discountShare,
        parts: [{ base: c.net, tax: c.tax, rate: c.taxable ? t.taxRate : 0 }],
        classification: CLASS_OTHERS,
      };
    }),
  });
}

/**
 * One UBL line per credited invoice line (same item, quantity, discount share and SST as on the
 * printed credit note), or null to fall back to one summary line: amount-only credits, and any
 * rows that do not add up to the credit note's own net / SST to the sen.
 * @param {{ amount: number, taxAmount: number, taxRate: number, lines?: Array<{ description: string, quantity: number, unitPrice: number, total: number, net: number, taxAmount: number }> }} p
 */
export function creditNoteItemLines(p) {
  const rows = (p.lines || []).filter((l) => l.quantity > 0);
  if (!rows.length) return null;
  const netC = rows.reduce((s, l) => s + toCents(l.net), 0);
  const taxC = rows.reduce((s, l) => s + toCents(l.taxAmount), 0);
  if (netC !== toCents(p.amount) - toCents(p.taxAmount) || taxC !== toCents(p.taxAmount)) return null;
  return rows.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    gross: money(l.total),
    discount: money(Math.max(0, l.total - l.net)),
    parts: [{ base: money(l.net), tax: money(l.taxAmount), rate: l.taxAmount > 0 ? p.taxRate : 0 }],
    classification: CLASS_OTHERS,
  }));
}

/**
 * Credit note (02) or refund note (04, money returned to the buyer) referring to the original
 * invoice's e-Invoice or the consolidated e-Invoice that reported it. Same structure for both.
 * @param {{ typeCode?: "02" | "04", number: string, issueDate: string, issueTime: string, supplier: Record<string, any>, customer: Record<string, any>, originalInvoiceNumber: string, reference: { number: string, uuid: string }, reason: string, amount: number, taxAmount: number, taxRate: number, lines?: Array<{ description: string, quantity: number, unitPrice: number, total: number, net: number, taxAmount: number }> }} p
 */
// 【中文】贷项通知（02）或退款单（04，钱已退回买方），都引用原发票或合并发票的电子发票，结构相同。
export function buildCreditNoteJson(p) {
  const typeCode = p.typeCode === DOC_TYPE.REFUND_NOTE ? DOC_TYPE.REFUND_NOTE : DOC_TYPE.CREDIT_NOTE;
  const net = money(p.amount - p.taxAmount);
  const itemised = creditNoteItemLines(p);
  const what = typeCode === DOC_TYPE.REFUND_NOTE ? "Refund" : "Credit";
  return buildUblDocument({
    typeCode,
    number: p.number,
    issueDate: p.issueDate,
    issueTime: p.issueTime,
    supplier: p.supplier,
    customer: p.customer,
    billingReference: p.reference,
    lines: itemised ?? [{
      description: `${what} for invoice ${p.originalInvoiceNumber}: ${p.reason}`,
      quantity: 1,
      unitPrice: net,
      gross: net,
      discount: 0,
      parts: splitByTax(net, p.taxAmount, p.taxRate),
      classification: CLASS_OTHERS,
    }],
  });
}

/** @param {{ net: number, tax: number, rate: number }} l */
const rateKey = (l) => (Number(l.rate) > 0 ? money(l.rate) : 0);

/**
 * Group the month's invoices into continuous ranges for the consolidated e-Invoice (LHDN allows a
 * consolidated line to summarise a continuous range of receipt / invoice numbers). Invoices follow
 * each other in issue order (`sequence`: every invoice number of the month, in or out of this
 * consolidated e-Invoice). A range stops at an invoice that is not in it (e-Invoiced on its own,
 * cancelled), and at a change of SST rate. Invoices covered with nothing left to report (fully
 * credited, `covered`) neither stop nor start a range. Totals are summed in sen, and the tax
 * buckets are the sum of each invoice's own, so the document totals equal one line per invoice.
 * @param {Array<{ invoiceNumber: string, net: number, tax: number, rate: number }>} lines reportable invoices
 * @param {string[]} [sequence] all invoice numbers of the month in issue order
 * @param {string[]} [covered]
 */
// 【中文】把一个月的发票按连续号码分组（LHDN 允许合并发票的一行代表一段连续号码）：中间有不在合并发票里的发票（单独开过、已取消）或税率不同就断开；
// 全额退款、没东西可申报的发票不会断开。金额按仙相加，税额分组是每张发票自己的加总，所以总额和一张发票一行完全相同。
export function consolidatedRanges(lines, sequence, covered = []) {
  const byNo = new Map(lines.map((l) => [l.invoiceNumber, l]));
  const neutral = new Set(covered);
  const seen = new Set();
  /** @type {Array<{ first: string, last: string, count: number, rate: number, netC: number, taxC: number, bases: Map<number, { baseC: number, taxC: number }> }>} */
  const groups = [];
  let open = null;
  const start = (l) => ({ first: l.invoiceNumber, last: l.invoiceNumber, count: 0, rate: rateKey(l), netC: 0, taxC: 0, bases: new Map() });
  const add = (g, l) => {
    g.last = l.invoiceNumber;
    g.count += 1;
    g.netC += toCents(l.net);
    g.taxC += toCents(l.tax);
    for (const part of splitByTax(l.net, l.tax, l.rate)) {
      const b = g.bases.get(part.rate) || { baseC: 0, taxC: 0 };
      b.baseC += toCents(part.base);
      b.taxC += toCents(part.tax);
      g.bases.set(part.rate, b);
    }
  };
  for (const no of sequence && sequence.length ? sequence : lines.map((l) => l.invoiceNumber)) {
    const l = byNo.get(no);
    if (l && !seen.has(no)) {
      seen.add(no);
      if (!open || open.rate !== rateKey(l)) {
        open = start(l);
        groups.push(open);
      }
      add(open, l);
    } else if (!neutral.has(no)) {
      open = null; // not in this consolidated e-Invoice: the range stops here
    }
  }
  // Safety net: an invoice missing from `sequence` gets a line of its own.
  for (const l of lines) {
    if (seen.has(l.invoiceNumber)) continue;
    seen.add(l.invoiceNumber);
    const g = start(l);
    add(g, l);
    groups.push(g);
  }
  return groups.map((g) => ({
    first: g.first,
    last: g.last,
    count: g.count,
    rate: g.rate,
    net: fromCents(g.netC),
    tax: fromCents(g.taxC),
    // Taxed bucket first, then the untaxed one (same order as splitByTax).
    parts: [...g.bases.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([rate, b]) => ({ base: fromCents(b.baseC), tax: fromCents(b.taxC), rate })),
  }));
}

/**
 * Monthly consolidated e-Invoice (buyer General Public). `layout` "per_invoice" (default): one
 * line per invoice; "ranges": one line per continuous range of invoice numbers (consolidatedRanges).
 * @param {{ number: string, issueDate: string, issueTime: string, supplier: Record<string, any>, lines: Array<{ invoiceNumber: string, net: number, tax: number, rate: number }>, layout?: "per_invoice" | "ranges", sequence?: string[], covered?: string[] }} p
 */
export function buildConsolidatedJson(p) {
  const ublLines =
    p.layout === "ranges"
      ? consolidatedRanges(p.lines, p.sequence, p.covered).map((g) => ({
          description: g.count === 1 ? `Invoice ${g.first}` : `Invoices ${g.first} - ${g.last} (${g.count} invoices)`,
          quantity: 1,
          unitPrice: g.net,
          gross: g.net,
          discount: 0,
          parts: g.parts,
          classification: CLASS_CONSOLIDATED,
        }))
      : p.lines.map((l) => ({
          description: `Invoice ${l.invoiceNumber}`,
          quantity: 1,
          unitPrice: money(l.net),
          gross: money(l.net),
          discount: 0,
          parts: splitByTax(l.net, l.tax, l.rate),
          classification: CLASS_CONSOLIDATED,
        }));
  return buildUblDocument({
    typeCode: DOC_TYPE.INVOICE,
    number: p.number,
    issueDate: p.issueDate,
    issueTime: p.issueTime,
    supplier: p.supplier,
    customer: GENERAL_PUBLIC,
    lines: ublLines,
  });
}

/**
 * The consolidated e-Invoice to send: one line per invoice while that stays well under LHDN's
 * 300 KB per document (about 300 invoices), else one line per continuous range of invoice
 * numbers. Refused with a reason when even the ranges would not fit.
 * @param {Parameters<typeof buildConsolidatedJson>[0]} p
 */
// 【中文】决定合并电子发票的写法：一张发票一行能远低于 LHDN 每份 300 KB 上限时照旧；否则按连续号码分段；还是太大就拒绝并说明。
export function planConsolidatedDocument(p) {
  const perInvoice = buildConsolidatedJson({ ...p, layout: "per_invoice" });
  const one = docBytes(perInvoice);
  if (one <= SAFE_DOC_BYTES) return { ok: true, doc: perInvoice, layout: "per_invoice", bytes: one };
  const ranged = buildConsolidatedJson({ ...p, layout: "ranges" });
  const bytes = docBytes(ranged);
  if (bytes <= SAFE_DOC_BYTES) return { ok: true, doc: ranged, layout: "ranges", bytes };
  return {
    ok: false,
    layout: "ranges",
    bytes,
    error:
      `This month's consolidated e-Invoice would be about ${Math.ceil(bytes / 1024)} KB even with invoices grouped by number range, ` +
      "over LHDN's limit of 300 KB per document (too many breaks between ranges, e.g. many invoices e-Invoiced on their own). Nothing was sent. " +
      "Contact support: the month has to be reported in more than one consolidated e-Invoice.",
  };
}

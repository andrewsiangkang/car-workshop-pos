// QA (review): the UBL payloads LHDN gets must add up to the printed totals to the sen
// (SST ALL and LABOR, discounts, credit / refund notes, consolidated), and the consolidated
// e-Invoice must stay under LHDN's 300 KB per document with 1,000 invoices a month.
import test from "node:test";
import assert from "node:assert/strict";
import { computeTotals, computeTotalsV0329 } from "../src/lib/tax-core.mjs";
import { toCents } from "../src/lib/money-core.mjs";
import {
  LHDN_MAX_DOC_BYTES,
  SAFE_DOC_BYTES,
  buildConsolidatedJson,
  buildCreditNoteJson,
  buildInvoiceJson,
  buyerProblem,
  consolidatedRanges,
  docBytes,
  documentTotals,
  payableOf,
  planConsolidatedDocument,
} from "../src/lib/einvoice2-ubl.mjs";

const supplier = {
  name: "Ah Seng Auto", tin: "C12345678901", brn: "202001012345", sst: "W10-1808-32000001", msic: "45201",
  msicDesc: "Maintenance and repair of motor vehicles", phone: "+60312345678", address: "12 Jalan Besi",
  city: "Petaling Jaya", postcode: "47300", stateCode: "10",
};
const walkIn = { name: "Walk-in Ali", tin: null, phone: "N/A" };
const stamp = { issueDate: "2026-11-14", issueTime: "06:00:00Z" };
const inv = (doc) => doc.Invoice[0];
const cents = (n) => toCents(n);

const items = [
  { description: "Brake pads", quantity: 2, unitPrice: 89.9, total: 179.8, type: "PART" },
  { description: "Engine oil 4L", quantity: 1, unitPrice: 133.33, total: 133.33, type: "PART" },
  { description: "Labour: brake service", quantity: 1.5, unitPrice: 60, total: 90, type: "LABOR" },
  { description: "Labour: oil change", quantity: 1, unitPrice: 36.25, total: 36.25, type: "LABOR" },
];

for (const [scope, rate, discount] of [["ALL", 8, 0], ["ALL", 8, 17.77], ["LABOR", 8, 0], ["LABOR", 6, 25.01], ["ALL", 0, 10]]) {
  test(`invoice totals match the printed invoice to the sen (SST ${scope} ${rate}%, discount ${discount})`, () => {
    const printed = computeTotals(items, discount, rate, scope);
    const doc = buildInvoiceJson({ invoiceNumber: "INV20261114001", ...stamp, supplier, customer: walkIn, lines: items, discount, taxRate: rate, taxScope: scope });
    const t = documentTotals(doc);
    assert.equal(cents(t.payable), cents(printed.totalAmount));
    assert.equal(cents(t.tax), cents(printed.taxAmount));
    assert.equal(cents(t.net), cents(printed.totalAmount) - cents(printed.taxAmount));
    // The lines add up to the document totals (what MyInvois checks).
    assert.equal(cents(t.lineNet), cents(t.net));
    assert.equal(cents(t.lineTax), cents(t.tax));
    // Tax subtotals: taxable amounts add up to the net, SST only at the invoice's rate.
    const subs = inv(doc).TaxTotal[0].TaxSubtotal;
    assert.equal(subs.reduce((s, x) => s + cents(x.TaxableAmount[0]._), 0), cents(t.net));
    for (const x of subs) if (x.TaxAmount[0]._ > 0) assert.equal(x.Percent[0]._, rate);
    assert.equal(inv(doc).InvoiceTypeCode[0]._, "01");
  });
}

test("labour-only SST: parts lines carry no SST", () => {
  const doc = buildInvoiceJson({ invoiceNumber: "INV1", ...stamp, supplier, customer: walkIn, lines: items, discount: 0, taxRate: 8, taxScope: "LABOR" });
  const lines = inv(doc).InvoiceLine;
  assert.equal(lines[0].TaxTotal[0].TaxAmount[0]._, 0);
  assert.equal(lines[1].TaxTotal[0].TaxAmount[0]._, 0);
  assert.ok(lines[2].TaxTotal[0].TaxAmount[0]._ > 0);
});

const creditLines = [
  { description: "Brake pads", quantity: 1, unitPrice: 89.9, total: 89.9, net: 89.9, taxAmount: 7.19 },
  { description: "Labour: brake service", quantity: 0.5, unitPrice: 60, total: 30, net: 30, taxAmount: 2.4 },
];
const cnBase = {
  number: "CN20261114001", ...stamp, supplier, customer: walkIn, originalInvoiceNumber: "INV20261101001",
  reference: { number: "INV20261101001", uuid: "UUIDORIGINAL0001" }, reason: "Part returned", taxRate: 8,
};

test("credit note (02): itemised lines add up to the credit note", () => {
  const doc = buildCreditNoteJson({ ...cnBase, amount: 129.49, taxAmount: 9.59, lines: creditLines });
  const t = documentTotals(doc);
  assert.equal(cents(t.payable), cents(129.49));
  assert.equal(cents(t.tax), cents(9.59));
  assert.equal(t.lineCount, 2);
  assert.equal(inv(doc).InvoiceTypeCode[0]._, "02");
  assert.deepEqual(inv(doc).BillingReference[0].InvoiceDocumentReference[0].UUID, [{ _: "UUIDORIGINAL0001" }]);
});

test("credit note: rows that do not add up fall back to one summary line with the same total", () => {
  const doc = buildCreditNoteJson({ ...cnBase, amount: 100, taxAmount: 7.41, lines: creditLines });
  const t = documentTotals(doc);
  assert.equal(t.lineCount, 1);
  assert.equal(cents(t.payable), cents(100));
  assert.equal(cents(t.tax), cents(7.41));
  assert.match(inv(doc).InvoiceLine[0].Item[0].Description[0]._, /^Credit for invoice INV20261101001/);
});

test("refund note (04): same structure and totals, refers to the original e-Invoice", () => {
  const doc = buildCreditNoteJson({ ...cnBase, typeCode: "04", amount: 50, taxAmount: 0, lines: [] });
  assert.equal(inv(doc).InvoiceTypeCode[0]._, "04");
  assert.equal(cents(documentTotals(doc).payable), cents(50));
  assert.equal(inv(doc).BillingReference[0].InvoiceDocumentReference[0].ID[0]._, "INV20261101001");
  assert.match(inv(doc).InvoiceLine[0].Item[0].Description[0]._, /^Refund for invoice/);
  // Anything else falls back to a credit note.
  assert.equal(inv(buildCreditNoteJson({ ...cnBase, typeCode: "99", amount: 50, taxAmount: 0 })).InvoiceTypeCode[0]._, "02");
});

test("buyer on the document: IC-only individual gets the general TIN with the MyKad; SSM seller is a BRN", () => {
  const buyer = { name: "Tan Ah Kow", tin: "EI00000000010", idType: "NRIC", idNo: "900101145678", phone: "+60123456789" };
  assert.equal(buyerProblem(buyer), null);
  const doc = buildInvoiceJson({ invoiceNumber: "INV1", ...stamp, supplier: { ...supplier, tin: "IG12345678901" }, customer: buyer, lines: items, discount: 0, taxRate: 8, taxScope: "ALL" });
  const cus = inv(doc).AccountingCustomerParty[0].Party[0].PartyIdentification;
  assert.deepEqual(cus.map((x) => x.ID[0]), [{ _: "EI00000000010", schemeID: "TIN" }, { _: "900101145678", schemeID: "NRIC" }]);
  const sup = inv(doc).AccountingSupplierParty[0].Party[0].PartyIdentification;
  assert.deepEqual(sup[1].ID[0], { _: "202001012345", schemeID: "BRN" });
  // A named individual needs a phone; the ID problems are reported before the phone.
  assert.match(buyerProblem({ ...buyer, phone: "-" }), /phone/);
  assert.match(buyerProblem({ name: "X", tin: "C12345678901", phone: "+60123456789" }), /no ID number/);
  // The builder itself refuses a buyer that would be rejected (never sends an unchecked ID).
  assert.throws(() => buildInvoiceJson({ invoiceNumber: "INV1", ...stamp, supplier, customer: { name: "X", tin: "C1", idType: "NRIC", idNo: "123" }, lines: items, discount: 0, taxRate: 0, taxScope: "ALL" }));
});

// ---------------------------------------------------------------------------
// Consolidated e-Invoice: 300 KB per document
// ---------------------------------------------------------------------------

/** A month of invoices INV20261001001… with ~20% labour-only SST mixes, some fully credited. */
function month(count, rate = 8) {
  const sequence = [];
  const lines = [];
  for (let i = 0; i < count; i++) {
    const day = String(1 + Math.floor(i / 40)).padStart(2, "0");
    const no = `INV202610${day}${String((i % 40) + 1).padStart(3, "0")}`;
    sequence.push(no);
    const net = Math.round((50 + ((i * 37) % 900) + (i % 7) * 0.13) * 100) / 100;
    // Every 5th invoice has SST on part of it (labour-only scope), the rest on all of it.
    const taxed = i % 5 === 0 ? Math.round(net * 40) / 100 : net;
    const tax = Math.round(taxed * rate) / 100;
    lines.push({ invoiceNumber: no, net, tax, rate, total: Math.round((net + tax) * 100) / 100 });
  }
  return { sequence, lines };
}
const sum = (xs, k) => xs.reduce((s, x) => s + toCents(x[k]), 0);

test("consolidated: one line per invoice while it is small", () => {
  const { sequence, lines } = month(50);
  const plan = planConsolidatedDocument({ number: "CON-202610", ...stamp, supplier, lines, sequence });
  assert.equal(plan.ok, true);
  assert.equal(plan.layout, "per_invoice");
  const t = documentTotals(plan.doc);
  assert.equal(t.lineCount, 50);
  assert.equal(cents(t.payable), sum(lines, "total"));
  assert.equal(inv(plan.doc).AccountingCustomerParty[0].Party[0].PartyName[0].Name[0]._, "General Public");
});

test("consolidated: 1,000 invoices are grouped into number ranges, well under 300 KB, totals to the sen", () => {
  const { sequence, lines } = month(1000);
  const perInvoice = buildConsolidatedJson({ number: "CON-202610", ...stamp, supplier, lines });
  assert.ok(docBytes(perInvoice) > LHDN_MAX_DOC_BYTES, "one line per invoice would be over LHDN's limit");
  const plan = planConsolidatedDocument({ number: "CON-202610", ...stamp, supplier, lines, sequence });
  assert.equal(plan.ok, true);
  assert.equal(plan.layout, "ranges");
  assert.ok(plan.bytes <= SAFE_DOC_BYTES && plan.bytes < LHDN_MAX_DOC_BYTES);
  const t = documentTotals(plan.doc);
  assert.equal(t.lineCount, 1);
  assert.equal(inv(plan.doc).InvoiceLine[0].Item[0].Description[0]._, "Invoices INV20261001001 - INV20261025040 (1000 invoices)");
  // Same totals as one line per invoice, to the sen: payable, SST and each tax bucket.
  const pt = documentTotals(perInvoice);
  assert.equal(cents(t.payable), cents(pt.payable));
  assert.equal(cents(t.payable), sum(lines, "total"));
  assert.equal(cents(t.tax), sum(lines, "tax"));
  assert.equal(cents(t.net), sum(lines, "net"));
  const buckets = (doc) => Object.fromEntries(inv(doc).TaxTotal[0].TaxSubtotal.map((x) => [x.Percent[0]._, [x.TaxableAmount[0]._, x.TaxAmount[0]._]]));
  assert.deepEqual(buckets(plan.doc), buckets(perInvoice));
  assert.equal(inv(plan.doc).InvoiceLine[0].Item[0].CommodityClassification[0].ItemClassificationCode[0]._, "004");
});

test("consolidated ranges stop at an invoice that is not in it and at an SST rate change", () => {
  const { sequence, lines } = month(1000);
  // INV20261005010 was e-Invoiced on its own; from INV20261020001 SST is 6%.
  const cut = "INV20261005010";
  const mine = lines
    .filter((l) => l.invoiceNumber !== cut)
    .map((l) => (l.invoiceNumber >= "INV20261020001" ? { ...l, rate: 6, tax: Math.round(l.net * 6) / 100 } : l));
  const groups = consolidatedRanges(mine, sequence);
  assert.deepEqual(
    groups.map((g) => [g.first, g.last, g.count, g.rate]),
    [
      ["INV20261001001", "INV20261005009", 169, 8],
      ["INV20261005011", "INV20261019040", 590, 8],
      ["INV20261020001", "INV20261025040", 240, 6],
    ]
  );
  assert.equal(groups.reduce((s, g) => s + toCents(g.net), 0), sum(mine, "net"));
  assert.equal(groups.reduce((s, g) => s + toCents(g.tax), 0), sum(mine, "tax"));
  // Each range's tax buckets add up to its net.
  for (const g of groups) assert.equal(g.parts.reduce((s, p) => s + toCents(p.base), 0), toCents(g.net));
});

test("consolidated ranges: a fully credited invoice (nothing to report) does not break a range", () => {
  const { sequence, lines } = month(30);
  const zero = lines[10].invoiceNumber;
  const mine = lines.filter((l) => l.invoiceNumber !== zero);
  assert.equal(consolidatedRanges(mine, sequence, [zero]).length, 1);
  assert.equal(consolidatedRanges(mine, sequence).length, 2);
  // An invoice missing from the sequence still gets a line of its own (never dropped).
  const extra = { invoiceNumber: "INV-OLD-1", net: 10, tax: 0, rate: 8 };
  const g = consolidatedRanges([...mine, extra], sequence, [zero]);
  assert.equal(g.length, 2);
  assert.deepEqual([g[1].first, g[1].count], ["INV-OLD-1", 1]);
});

test("consolidated: refused with a reason when even ranges would not fit", () => {
  const { sequence, lines } = month(1600);
  // Every other invoice was e-Invoiced on its own: 800 one-invoice ranges.
  const mine = lines.filter((_, i) => i % 2 === 0);
  const plan = planConsolidatedDocument({ number: "CON-202610", ...stamp, supplier, lines: mine, sequence });
  assert.equal(plan.ok, false);
  assert.match(plan.error, /300 KB/);
  assert.match(plan.error, /Nothing was sent/);
});

test("an invoice issued under v0.3.29 (older rounding) is rebuilt with that rounding, so its e-Invoice still matches the stored total", () => {
  // RM 36.25 labour at 6%: v0.3.29 stored SST 2.17 / total 38.42; today's half-up rounding gives 2.18 / 38.43.
  const lines = [{ description: "Labour: oil change", quantity: 1, unitPrice: 36.25, total: 36.25, type: "LABOR" }];
  const base = { invoiceNumber: "INV20261020003", ...stamp, supplier, customer: walkIn, lines, discount: 0, taxRate: 6, taxScope: "LABOR" };
  assert.equal(computeTotals(lines, 0, 6, "LABOR").taxAmount, 2.18);
  assert.equal(computeTotalsV0329(lines, 0, 6, "LABOR").taxAmount, 2.17);
  assert.equal(computeTotalsV0329(lines, 0, 6, "LABOR").totalAmount, 38.42);
  // Without the stored SST (or with today's): today's rounding.
  assert.equal(payableOf(buildInvoiceJson(base)), 38.43);
  assert.equal(payableOf(buildInvoiceJson({ ...base, issuedTax: 2.18 })), 38.43);
  // Issued under v0.3.29: the line tax is the one printed then.
  const legacy = buildInvoiceJson({ ...base, issuedTax: 2.17 });
  assert.equal(payableOf(legacy), 38.42);
  const t = documentTotals(legacy);
  assert.equal(t.lineTax, 2.17);
  assert.equal(t.lineNet, 36.25);
  // A stored SST neither rounding gives is not "fixed" here: the route's total check refuses it.
  assert.equal(payableOf(buildInvoiceJson({ ...base, issuedTax: 2.5 })), 38.43);
});

import test from "node:test";
import assert from "node:assert/strict";
import { itemSales, jobPeriodSen, periodTotals, operatingExpenses, splitMixSen } from "../src/lib/money-reports.mjs";
import { jobProfit, sstCollected } from "../src/lib/order-profit.mjs";
import { computeCreditNote } from "../src/lib/credit-calc.mjs";
import { computeTotals, computeTotalsV0329 } from "../src/lib/tax-core.mjs";

const pad = (d) => String(d).padStart(2, "0");
const OCT = (d) => new Date(`2026-10-${pad(d)}T04:00:00Z`);
const NOV = (d) => new Date(`2026-11-${pad(d)}T04:00:00Z`);
const inOct = (at) => at >= new Date("2026-09-30T16:00:00Z") && at < new Date("2026-10-31T16:00:00Z");
const inNov = (at) => at >= new Date("2026-10-31T16:00:00Z") && at < new Date("2026-11-30T16:00:00Z");
const always = () => true;
const sen = (rm) => Math.round(rm * 100);

// RM108 job (parts 60 + labour 40, SST 8 on everything), parts cost RM30.
const job = (over = {}) => ({
  id: "J1",
  totalAmount: 108, creditedAmount: 0, taxAmount: 8, paidAmount: 108, roundingAdjustment: 0,
  partsAmount: 60, laborAmount: 40,
  items: [{ id: "P", costPrice: 30, quantity: 1 }, { id: "L", costPrice: 0, quantity: 1 }],
  creditNotes: [],
  payments: [{ amount: 108, paidAt: OCT(5) }],
  ...over,
});

// RM106 job from the review: labour 50 + one part 50 (cost 40), SST 6.
const job106 = (over = {}) => ({
  id: "J106",
  totalAmount: 106, creditedAmount: 0, taxAmount: 6, paidAmount: 106, roundingAdjustment: 0,
  partsAmount: 50, laborAmount: 50,
  items: [{ id: "P", costPrice: 40, quantity: 1 }, { id: "L", costPrice: 0, quantity: 1 }],
  creditNotes: [],
  payments: [{ amount: 106, paidAt: OCT(5) }],
  ...over,
});

test("collections follow the Payment ledger: half in October, half in November", () => {
  const j = job({ payments: [{ amount: 54, paidAt: OCT(30) }, { amount: 54, paidAt: NOV(2) }] });
  const oct = periodTotals([j], inOct);
  const nov = periodTotals([j], inNov);
  assert.equal(oct.collections, 54);
  assert.equal(nov.collections, 54);
  assert.equal(oct.sst + nov.sst, 8);
  assert.equal(oct.partsCost + nov.partsCost, 30);
  assert.equal(oct.sst, 4);
  assert.equal(oct.grossProfit, 54 - 4 - 15);
  assert.equal(oct.paidJobs, 1);
});

test("a refund is a negative collection in the month it was paid back", () => {
  // Paid 108 in October; 54 credited (SST 4 credited back) and refunded in November.
  const j = job({
    creditedAmount: 54, paidAmount: 54,
    creditNotes: [{ amount: 54, taxAmount: 4, createdAt: NOV(3), lines: [] }],
    payments: [{ amount: 108, paidAt: OCT(5) }, { amount: -54, paidAt: NOV(3) }],
  });
  const oct = periodTotals([j], inOct);
  const nov = periodTotals([j], inNov);
  assert.equal(oct.collections, 108);
  assert.equal(oct.sst, 8);
  assert.equal(nov.collections, -54);
  assert.equal(nov.refunds, 54);
  assert.equal(nov.received, 0);
  assert.equal(nov.paidJobs, 0);
  assert.equal(nov.sst, -4);
  // Over both months the SST equals the job page's figure after the credit note.
  assert.equal(sen(oct.sst + nov.sst), sen(sstCollected(j)));
});

test("a later goodwill credit + refund never changes a month that is already closed", () => {
  const before = periodTotals([job106()], inOct);
  assert.deepEqual([before.collections, before.sst, before.partsCost, before.grossProfit], [106, 6, 40, 60]);
  // November: RM53 goodwill credit note (SST 3), refunded, no part back to stock.
  const j = job106({
    creditedAmount: 53, paidAmount: 53,
    creditNotes: [{ amount: 53, taxAmount: 3, createdAt: NOV(10), lines: [] }],
    payments: [{ amount: 106, paidAt: OCT(5) }, { amount: -53, paidAt: NOV(10) }],
  });
  const oct = periodTotals([j], inOct);
  const nov = periodTotals([j], inNov);
  assert.deepEqual([oct.collections, oct.sst, oct.partsCost, oct.grossProfit], [106, 6, 40, 60]);
  assert.deepEqual([nov.collections, nov.sst, nov.partsCost, nov.grossProfit], [-53, -3, 0, -50]);
  // All months together = the job page's gross profit.
  assert.equal(oct.grossProfit + nov.grossProfit, jobProfit(j).grossProfit);
});

test("a fully credited and refunded job still counts the cost of parts not returned to stock", () => {
  const j = job106({
    creditedAmount: 106, paidAmount: 0,
    creditNotes: [{ amount: 106, taxAmount: 6, createdAt: NOV(10), lines: [] }],
    payments: [{ amount: 106, paidAt: OCT(5) }, { amount: -106, paidAt: NOV(10) }],
  });
  const oct = periodTotals([j], inOct);
  const nov = periodTotals([j], inNov);
  assert.deepEqual([oct.sst, oct.partsCost, oct.grossProfit], [6, 40, 60]);
  assert.deepEqual([nov.collections, nov.sst, nov.partsCost, nov.grossProfit], [-106, -6, 0, -100]);
  const all = periodTotals([j], always);
  assert.deepEqual([all.collections, all.sst, all.partsCost, all.grossProfit], [0, 0, 40, -40]);
  assert.equal(all.grossProfit, jobProfit(j).grossProfit);
  // Same job, part put back on the shelf: then nothing is lost.
  const back = { ...j, creditNotes: [{ amount: 106, taxAmount: 6, createdAt: NOV(10), lines: [{ workOrderItemId: "P", returnedToStock: 1 }] }] };
  const allBack = periodTotals([back], always);
  assert.deepEqual([allBack.partsCost, allBack.grossProfit], [0, 0]);
  assert.equal(periodTotals([back], inNov).partsCost, -40);
});

test("credit note before payment: the reduced bill, once paid, carries the full parts cost", () => {
  // Invoice 106, RM53 credited (SST 3) before the customer paid; customer then pays 53.
  const j = job106({
    creditedAmount: 53, paidAmount: 53,
    creditNotes: [{ amount: 53, taxAmount: 3, createdAt: OCT(3), lines: [] }],
    payments: [{ amount: 53, paidAt: OCT(10) }],
  });
  const oct = periodTotals([j], inOct);
  assert.deepEqual([oct.collections, oct.sst, oct.partsCost, oct.grossProfit], [53, 3, 40, 10]);
});

test("labour-only SST: crediting a part keeps the labour SST owed", () => {
  // Part 100 (cost 60) + labour 50, SST 6% on labour only = 3, total 153. Part credited (no SST).
  const j = {
    id: "JL", totalAmount: 153, taxAmount: 3, roundingAdjustment: 0, partsAmount: 100, laborAmount: 50,
    items: [{ id: "P", costPrice: 60, quantity: 1 }, { id: "L", costPrice: 0, quantity: 1 }],
    creditNotes: [{ amount: 100, taxAmount: 0, createdAt: OCT(3), lines: [{ workOrderItemId: "P", returnedToStock: 1 }] }],
    payments: [{ amount: 53, paidAt: OCT(10) }],
  };
  const oct = periodTotals([j], inOct);
  assert.deepEqual([oct.collections, oct.sst, oct.partsCost, oct.grossProfit], [53, 3, 0, 50]);
});

test("credit against the balance after a part payment: the rest of the cost is counted that month", () => {
  // 53 paid in October, the other 53 credited (not refunded, nothing returned) in November.
  const j = job106({
    creditedAmount: 53, paidAmount: 53,
    creditNotes: [{ amount: 53, taxAmount: 3, createdAt: NOV(2), lines: [] }],
    payments: [{ amount: 53, paidAt: OCT(10) }],
  });
  const oct = periodTotals([j], inOct);
  const nov = periodTotals([j], inNov);
  assert.deepEqual([oct.sst, oct.partsCost], [3, 20]);
  assert.deepEqual([nov.collections, nov.sst, nov.partsCost, nov.grossProfit], [0, 0, 20, -20]);
  assert.equal(nov.paidJobs, 0);
  assert.deepEqual(nov.perJob, []);
  assert.equal(oct.grossProfit + nov.grossProfit, jobProfit(j).grossProfit);
});

test("parts returned to stock by a credit note are no longer a cost", () => {
  const j = job({ creditNotes: [{ amount: 0, taxAmount: 0, createdAt: OCT(1), lines: [{ workOrderItemId: "P", returnedToStock: 1 }] }] });
  assert.equal(periodTotals([j], inOct).partsCost, 0);
});

test("partly paid job: SST and cost follow the share paid", () => {
  const j = job({ paidAmount: 27, payments: [{ amount: 27, paidAt: OCT(5) }] });
  const s = jobPeriodSen(j, inOct);
  assert.equal(s.collected, 2700);
  assert.equal(s.sst, 200); // a quarter of 8.00
  assert.equal(s.partsCost, 750); // a quarter of 30.00
  assert.equal(s.partsSales, 1500);
  assert.equal(s.laborSales, 1000);
});

// Brake pads (part, 200, cost 120) + labour 100, no SST: total 300.
const padsJob = (over = {}) => ({
  id: "JP", totalAmount: 300, taxAmount: 0, roundingAdjustment: 0, partsAmount: 200, laborAmount: 100,
  items: [{ id: "P", type: "PART", costPrice: 120, quantity: 1 }, { id: "L", type: "LABOR", costPrice: 0, quantity: 1 }],
  creditNotes: [],
  payments: [],
  ...over,
});
const padsCredit = (at) => ({
  amount: 200, taxAmount: 0, createdAt: at,
  lines: [{ workOrderItemId: "P", type: "PART", quantity: 1, total: 200, returnedToStock: 1 }],
});

test("revenue mix: pads credited before payment, then the labour is paid: all labour, no parts", () => {
  const j = padsJob({ creditNotes: [padsCredit(NOV(5))], payments: [{ amount: 100, paidAt: NOV(6) }] });
  const nov = periodTotals([j], inNov);
  assert.deepEqual([nov.collections, nov.partsSales, nov.laborSales, nov.partsCost], [100, 0, 100, 0]);
});

test("revenue mix: paid in October, pads credited and refunded in November: the refund comes off parts", () => {
  const j = padsJob({
    creditNotes: [padsCredit(NOV(5))],
    payments: [{ amount: 300, paidAt: OCT(5) }, { amount: -200, paidAt: NOV(5) }],
  });
  const oct = periodTotals([j], inOct);
  const nov = periodTotals([j], inNov);
  assert.deepEqual([oct.partsSales, oct.laborSales], [200, 100]);
  assert.deepEqual([nov.collections, nov.partsSales, nov.laborSales], [-200, -200, 0]);
  // Over both months: what the customer kept and paid for.
  const all = periodTotals([j], always);
  assert.deepEqual([all.partsSales, all.laborSales], [0, 100]);
});

test("revenue mix: a credit note without lines takes the same share off parts and labour", () => {
  // 106 paid in October; a RM53 goodwill credit (half the bill) refunded in November.
  const j = job106({
    creditNotes: [{ amount: 53, taxAmount: 3, createdAt: NOV(10), lines: [] }],
    payments: [{ amount: 106, paidAt: OCT(5) }, { amount: -53, paidAt: NOV(10) }],
  });
  assert.deepEqual([periodTotals([j], inOct).partsSales, periodTotals([j], inOct).laborSales], [50, 50]);
  assert.deepEqual([periodTotals([j], inNov).partsSales, periodTotals([j], inNov).laborSales], [-25, -25]);
});

// Brake pads 200 (part) + labour 100, SST 8% on labour only: total 308.
const labourSstJob = (over = {}) => ({
  id: "JLS", totalAmount: 308, taxAmount: 8, taxRate: 8, taxScope: "LABOR", discount: 0, roundingAdjustment: 0,
  partsAmount: 200, laborAmount: 100,
  items: [
    { id: "P", type: "PART", description: "Brake pads", costPrice: 120, quantity: 1, total: 200 },
    { id: "L", type: "LABOR", description: "Labour", costPrice: 0, quantity: 1, total: 100 },
  ],
  creditNotes: [],
  payments: [],
  ...over,
});
/** A real split credit note (credit-calc.mjs) on the labour-only SST job (or on `invoice`). */
const splitNote = (split, at, credited = { amount: 0, tax: 0 }, invoice = labourSstJob()) => {
  const r = computeCreditNote({ invoice, creditedAmount: credited.amount, creditedTax: credited.tax, mode: "split", split });
  assert.equal(r.ok, true, r.error);
  return { amount: r.amount, taxAmount: r.taxAmount, createdAt: at, lines: r.lines };
};

test("revenue mix, labour-only SST: a split credit of the parts comes off parts, not off labour", () => {
  const cn = splitNote({ labor: 0, parts: 200 }, NOV(5));
  assert.deepEqual([cn.amount, cn.taxAmount, cn.lines.length], [200, 0, 0]);
  const j = labourSstJob({ creditNotes: [cn], payments: [{ amount: 108, paidAt: NOV(6) }] });
  const nov = periodTotals([j], inNov);
  assert.deepEqual([nov.collections, nov.partsSales, nov.laborSales, nov.sst], [108, 0, 100, 8]);
});

test("revenue mix, labour-only SST: a split credit of half the labour leaves parts whole", () => {
  const cn = splitNote({ labor: 50, parts: 0 }, NOV(5));
  assert.deepEqual([cn.amount, cn.taxAmount], [54, 4]);
  const j = labourSstJob({ creditNotes: [cn], payments: [{ amount: 254, paidAt: NOV(6) }] });
  const nov = periodTotals([j], inNov);
  assert.deepEqual([nov.collections, nov.partsSales, nov.laborSales, nov.sst], [254, 200, 50, 4]);
});

// Same job with RM30 off: lines net 180 / 90, SST 7.20, total 277.20.
const discJob = (over = {}) => labourSstJob({ discount: 30, totalAmount: 277.2, taxAmount: 7.2, ...over });

test("revenue mix, labour-only SST with a discount: a split credit comes off at the value before discount", () => {
  const mixOf = (cn, paid) => {
    const t = periodTotals([discJob({ creditNotes: [cn], payments: [{ amount: paid, paidAt: NOV(6) }] })], inNov);
    return [t.partsSales, t.laborSales];
  };
  // All the labour (net 90) split-credited, the rest paid: no labour left, as with a line credit.
  const labour = splitNote({ labor: 90, parts: 0 }, NOV(5), undefined, discJob());
  assert.deepEqual([labour.amount, labour.taxAmount], [97.2, 7.2]);
  assert.deepEqual(mixOf(labour, 180), [200, 0]);
  const r = computeCreditNote({ invoice: discJob(), creditedAmount: 0, creditedTax: 0, mode: "lines", lines: [{ itemId: "L", quantity: 1 }] });
  const byLine = { amount: r.amount, taxAmount: r.taxAmount, createdAt: NOV(5), lines: r.lines.map((l) => ({ workOrderItemId: l.itemId, type: l.type, quantity: l.quantity, total: l.total })) };
  assert.deepEqual(mixOf(byLine, 180), [200, 0]);
  // All the parts (net 180) split-credited, the labour bill paid: no parts left.
  assert.deepEqual(mixOf(splitNote({ labor: 0, parts: 180 }, NOV(5), undefined, discJob()), 97.2), [0, 100]);
  // Half the net labour (45 of 90) is half the labour before discount.
  assert.deepEqual(mixOf(splitNote({ labor: 45, parts: 0 }, NOV(5), undefined, discJob()), 228.6), [200, 50]);
  // Net labour 50 of 90: 55.56 of the 100 before discount credited, 44.44 left.
  assert.deepEqual(mixOf(splitNote({ labor: 50, parts: 0 }, NOV(5), undefined, discJob()), 223.2), [200, 44.44]);
});

test("splitMixSen: SST tells labour from parts, grossed up for the discount, capped at what is left", () => {
  const job = { partsC: 20000, laborC: 10000, discountC: 3000, taxRate: 8 };
  assert.deepEqual(splitMixSen({ taxAmount: 7.2 }, 9720, job, 20000, 10000), { parts: 0, labor: 10000 });
  assert.deepEqual(splitMixSen({ taxAmount: 0 }, 18000, job, 20000, 10000), { parts: 20000, labor: 0 });
  // Capped at what is left of each type; no discount = no gross-up; a zero rate never divides by 0.
  assert.deepEqual(splitMixSen({ taxAmount: 7.2 }, 9720, job, 20000, 4000), { parts: 0, labor: 4000 });
  assert.deepEqual(splitMixSen({ taxAmount: 4 }, 5400, { ...job, discountC: 0 }, 20000, 10000), { parts: 0, labor: 5000 });
  assert.deepEqual(splitMixSen({ taxAmount: 0 }, 5000, { ...job, taxRate: 0, discountC: 0 }, 20000, 10000), { parts: 5000, labor: 0 });
});

test("revenue mix, SST on everything: a credit note without lines still takes the same share off both", () => {
  // The labour-only rule above is only for labour-only SST; ALL scope keeps the pro-rata rule.
  const j = job106({
    taxRate: 6, taxScope: "ALL",
    creditNotes: [{ amount: 53, taxAmount: 3, createdAt: NOV(10), lines: [] }],
    payments: [{ amount: 106, paidAt: OCT(5) }, { amount: -53, paidAt: NOV(10) }],
  });
  assert.deepEqual([periodTotals([j], inNov).partsSales, periodTotals([j], inNov).laborSales], [-25, -25]);
});

// Top Selling: brake pads 200 (part) + labour 100, no SST, total 300 (padsJob with descriptions and totals).
const topJob = (over = {}) => padsJob({
  items: [
    { id: "P", type: "PART", description: "Brake pads", costPrice: 120, quantity: 1, total: 200 },
    { id: "L", type: "LABOR", description: "Labour", costPrice: 0, quantity: 1, total: 100 },
  ],
  ...over,
});
const topOf = (jobs, inPeriod) => {
  const t = periodTotals(jobs, inPeriod);
  const items = Object.fromEntries([...itemSales(jobs, t.perJob)].map(([k, v]) => [k, Math.round(v.sales * 100) / 100]));
  return { t, items };
};

test("top selling: a goodwill credit (amount only) lowers the share; items match collections and the revenue mix", () => {
  // RM150 goodwill credit, then RM150 paid: RM150 of item sales, not the whole RM300.
  const goodwill = { amount: 150, taxAmount: 0, createdAt: NOV(5), lines: [] };
  const { t, items } = topOf([topJob({ creditNotes: [goodwill], payments: [{ amount: 150, paidAt: NOV(6) }] })], inNov);
  assert.deepEqual(items, { "Brake pads": 100, Labour: 50 });
  assert.deepEqual([t.collections, t.partsSales, t.laborSales], [150, 100, 50]);
  // RM299 credit, RM1 paid: a third of a ringgit of pads, not RM200.
  const big = topOf([topJob({ creditNotes: [{ ...goodwill, amount: 299 }], payments: [{ amount: 1, paidAt: NOV(6) }] })], inNov);
  assert.deepEqual(big.items, { "Brake pads": 0.67, Labour: 0.33 });
});

test("top selling: pads credited by line leave only the labour; a later goodwill credit lowers its share", () => {
  const lineOnly = topOf([topJob({ creditNotes: [padsCredit(NOV(5))], payments: [{ amount: 100, paidAt: NOV(6) }] })], inNov);
  assert.deepEqual(lineOnly.items, { Labour: 100 });
  const mixed = topOf([topJob({
    creditNotes: [padsCredit(NOV(5)), { amount: 50, taxAmount: 0, createdAt: NOV(5), lines: [] }],
    payments: [{ amount: 50, paidAt: NOV(6) }],
  })], inNov);
  assert.deepEqual(mixed.items, { Labour: 50 });
  assert.deepEqual([mixed.t.partsSales, mixed.t.laborSales], [0, 50]);
});

test("top selling, labour-only SST: a split credit takes its own type off, as in the revenue mix", () => {
  // Split credit of the pads, then the labour bill (108) paid: the pads were never sold.
  const parts = topOf([labourSstJob({ creditNotes: [splitNote({ labor: 0, parts: 200 }, NOV(5))], payments: [{ amount: 108, paidAt: NOV(6) }] })], inNov);
  assert.deepEqual(parts.items, { Labour: 100 });
  assert.deepEqual([parts.t.partsSales, parts.t.laborSales], [0, 100]);
  // Split credit of all the labour, then the pads (200) paid.
  const labour = topOf([labourSstJob({ creditNotes: [splitNote({ labor: 100, parts: 0 }, NOV(5))], payments: [{ amount: 200, paidAt: NOV(6) }] })], inNov);
  assert.deepEqual(labour.items, { "Brake pads": 200 });
  assert.deepEqual([labour.t.partsSales, labour.t.laborSales], [200, 0]);
  // Half the labour credited, the rest paid half in November: half of everything that is left.
  const half = labourSstJob({ creditNotes: [splitNote({ labor: 50, parts: 0 }, NOV(5))], payments: [{ amount: 127, paidAt: NOV(6) }] });
  const h = topOf([half], inNov);
  assert.deepEqual(h.items, { "Brake pads": 100, Labour: 25 });
  assert.deepEqual([h.t.partsSales, h.t.laborSales], [100, 25]);
  const units = itemSales([half], h.t.perJob);
  assert.deepEqual([units.get("Brake pads").quantity, units.get("Labour").quantity], [0.5, 0.25]);
  // With a discount the split amounts are net: they are grossed up, as in the revenue mix.
  const disc = topOf([discJob({ creditNotes: [splitNote({ labor: 90, parts: 0 }, NOV(5), undefined, discJob())], payments: [{ amount: 180, paidAt: NOV(6) }] })], inNov);
  assert.deepEqual(disc.items, { "Brake pads": 200 });
  const discParts = topOf([discJob({ creditNotes: [splitNote({ labor: 0, parts: 180 }, NOV(5), undefined, discJob())], payments: [{ amount: 97.2, paidAt: NOV(6) }] })], inNov);
  assert.deepEqual(discParts.items, { Labour: 100 });
  assert.deepEqual([discParts.t.partsSales, discParts.t.laborSales], [0, 100]);
});

test("top selling: a job paid half in October and half in November is split between the months", () => {
  const j = topJob({ payments: [{ amount: 150, paidAt: OCT(30) }, { amount: 150, paidAt: NOV(2) }] });
  assert.deepEqual(topOf([j], inOct).items, { "Brake pads": 100, Labour: 50 });
  assert.deepEqual(topOf([j], inNov).items, { "Brake pads": 100, Labour: 50 });
});

test("cash rounding: a bill settled at the rounded amount has earned all its SST and cost", () => {
  // 106.02 rounded down to 106.00 in cash.
  const j = job106({ totalAmount: 106.02, roundingAdjustment: -0.02, paidAmount: 106, payments: [{ amount: 106, paidAt: OCT(5) }] });
  const oct = periodTotals([j], inOct);
  assert.deepEqual([oct.sst, oct.partsCost], [6, 40]);
});

test("jobs with no payment or credit note in the period are left out; nothing paid = nothing counted", () => {
  const t = periodTotals([job()], inNov);
  assert.equal(t.collections, 0);
  assert.equal(t.paidJobs, 0);
  assert.deepEqual(t.perJob, []);
  assert.deepEqual(jobPeriodSen(job(), inNov), {
    collected: 0, received: 0, refunds: 0, sst: 0, partsCost: 0, partsSales: 0, laborSales: 0, payments: 0, events: 0,
  });
});

test("operating expenses: Expenses page + vouchers not for a supplier invoice; voided never count", () => {
  const r = operatingExpenses({
    expenses: [{ amount: 1200, voidedAt: null }, { amount: 99.9, voidedAt: new Date() }, { amount: 0.1 }],
    vouchers: [
      { amount: 350.5, supplierInvoiceId: null, voidedAt: null }, // electricity paid from the drawer
      { amount: 800, supplierInvoiceId: "SI1", voidedAt: null }, // stock purchase: counted as parts cost when sold
      { amount: 20, supplierInvoiceId: null, voidedAt: "2026-11-02" },
    ],
  });
  assert.deepEqual(r, { expenses: 1200.1, vouchers: 350.5, supplierCharges: 0, supplierTax: 0, total: 1550.6 });
  // Delivery / service lines of a supplier invoice never become parts cost, so they count here.
  const withCharges = operatingExpenses({ expenses: [], vouchers: [], supplierCharges: [{ total: 25 }, { total: 0.35 }] });
  assert.deepEqual(withCharges, { expenses: 0, vouchers: 0, supplierCharges: 25.35, supplierTax: 0, total: 25.35 });
});

test("operating expenses: the tax paid on supplier invoices is counted once (parts cost is before tax)", () => {
  // Parts RM 1,000 + tax RM 100 = RM 1,100 paid by voucher: the voucher is not an expense, the parts
  // become parts cost when sold, and the RM 100 tax is an operating expense of the invoice's month.
  const r = operatingExpenses({
    expenses: [],
    vouchers: [{ amount: 1100, supplierInvoiceId: "SI1", voidedAt: null }],
    supplierCharges: [{ total: 30 }],
    supplierTax: [{ taxAmount: 100 }, { taxAmount: 8.45 }, { taxAmount: 50, voidedAt: "2026-11-03" }],
  });
  assert.deepEqual(r, { expenses: 0, vouchers: 0, supplierCharges: 30, supplierTax: 108.45, total: 138.45 });
});

// ---- Review round 4 ----

/** A credit note as credit-calc.mjs issues it, stored the way the report reads it. */
const issued = (invoice, credited, p, at) => {
  const r = computeCreditNote({ invoice, creditedAmount: credited.amount, creditedTax: credited.tax, ...p });
  assert.equal(r.ok, true, r.error);
  return {
    amount: r.amount, taxAmount: r.taxAmount, createdAt: at,
    lines: r.lines.map((l) => ({ workOrderItemId: l.itemId, type: l.type, quantity: l.quantity, total: l.total, returnedToStock: 0 })),
  };
};
/** A job as generate_invoice issues it (today's rounding, or v0.3.29's with `v0329`). */
const issuedJob = (id, items, rate, scope, v0329 = false) => {
  const t = (v0329 ? computeTotalsV0329 : computeTotals)(items, 0, rate, scope);
  const sum = (ty) => items.filter((i) => i.type === ty).reduce((s, i) => s + i.total, 0);
  return {
    id, totalAmount: t.totalAmount, taxAmount: t.taxAmount, taxRate: rate, taxScope: scope, discount: 0, roundingAdjustment: 0,
    partsAmount: sum("PART"), laborAmount: sum("LABOR"), items, creditNotes: [], payments: [],
  };
};
const padsItem = (total = 200) => ({ id: "P", type: "PART", description: "Brake pads", costPrice: 120, quantity: 1, total });
const labourItem = (total = 100, id = "L") => ({ id, type: "LABOR", description: "Labour", costPrice: 0, quantity: 1, total });

test("revenue mix: a goodwill credit, then a line credit: the mix matches what was collected and Top Selling", () => {
  // SST 8% on everything: RM54 goodwill (SST 4), then the pads returned by line (216 / SST 16), then 54 paid.
  const inv = issuedJob("JG", [padsItem(), labourItem()], 8, "ALL");
  assert.deepEqual([inv.totalAmount, inv.taxAmount], [324, 24]);
  const goodwill = issued(inv, { amount: 0, tax: 0 }, { mode: "amount", amount: 54 }, NOV(3));
  const pads = issued(inv, { amount: 54, tax: 4 }, { mode: "lines", lines: [{ itemId: "P", quantity: 1 }] }, NOV(4));
  assert.deepEqual([goodwill.taxAmount, pads.amount, pads.taxAmount], [4, 216, 16]);
  const { t, items } = topOf([{ ...inv, creditNotes: [goodwill, pads], payments: [{ amount: 54, paidAt: NOV(6) }] }], inNov);
  // Was labour 83.33 against RM50 of labour collected.
  assert.deepEqual([t.collections, t.sst, t.partsSales, t.laborSales], [54, 4, 0, 50]);
  assert.deepEqual(items, { Labour: 50 });
  // No SST: RM150 goodwill and the labour line (100), in either order, then 50 paid: RM50 of pads.
  const gw = { amount: 150, taxAmount: 0, lines: [] };
  const lab = { amount: 100, taxAmount: 0, lines: [{ workOrderItemId: "L", type: "LABOR", quantity: 1, total: 100 }] };
  for (const [a, b] of [[gw, lab], [lab, gw]]) {
    const j = topJob({ creditNotes: [{ ...a, createdAt: NOV(3) }, { ...b, createdAt: NOV(4) }], payments: [{ amount: 50, paidAt: NOV(6) }] });
    const r = topOf([j], inNov);
    assert.deepEqual([r.t.collections, r.t.partsSales, r.t.laborSales], [50, 50, 0]);
    assert.deepEqual(r.items, { "Brake pads": 50 });
  }
});

test("nothing left to pay because a negative cash rounding covers the last sen: parts not put back are still a cost", () => {
  // Battery 150 (cost 90) + labour 55.33, SST 8% on everything: total 221.76, paid 221.75 in cash.
  const battery = issuedJob("JR", [{ id: "B", type: "PART", description: "Battery", costPrice: 90, quantity: 1, total: 150 }, labourItem(55.33)], 8, "ALL");
  assert.equal(battery.totalAmount, 221.76);
  // The boss credits what the customer paid (221.75) in November and refunds all of it: nothing is due.
  const j = {
    ...battery, roundingAdjustment: -0.01,
    creditNotes: [issued(battery, { amount: 0, tax: 0 }, { mode: "amount", amount: 221.75 }, NOV(3))],
    payments: [{ amount: 221.75, paidAt: OCT(5) }, { amount: -221.75, paidAt: NOV(3) }],
  };
  assert.equal(periodTotals([j], inOct).partsCost, 90);
  // Was −90: the battery never went back on the shelf.
  assert.equal(periodTotals([j], inNov).partsCost, 0);
  // Labour-only SST, credited by split with the hint values before this round (221.75 / SST 1.61,
  // 1 sen short of the 221.76 invoice), paid 221.75 in cash and refunded in full.
  const two = issuedJob("JS", [padsItem(), labourItem(10.07, "L1"), labourItem(10.07, "L2")], 8, "LABOR");
  assert.deepEqual([two.totalAmount, two.taxAmount], [221.76, 1.62]);
  const split = {
    ...two, roundingAdjustment: -0.01,
    creditNotes: [{ amount: 221.75, taxAmount: 1.61, createdAt: NOV(3), lines: [] }],
    payments: [{ amount: 221.75, paidAt: OCT(5) }, { amount: -221.75, paidAt: NOV(3) }],
  };
  const all = periodTotals([split], always);
  assert.deepEqual([all.collections, all.sst, all.partsCost], [0, 0, 120]);
  assert.equal(all.partsCost, jobProfit({ ...split, creditedAmount: 221.75 }).netCost);
});

test("revenue mix, labour-only SST: a split credit of all the labour leaves no labour behind (SST is rounded to the sen)", () => {
  // Labour 100.06 + pads 200 at 8%: SST 8.00 read back is labour 100.00; the 6 sen left are labour too.
  const inv = issuedJob("JT", [padsItem(), labourItem(100.06)], 8, "LABOR");
  assert.deepEqual([inv.totalAmount, inv.taxAmount], [308.06, 8]);
  const cn = splitNote({ labor: 100.06, parts: 0 }, NOV(5), undefined, inv);
  assert.deepEqual([cn.amount, cn.taxAmount], [108.06, 8]);
  const r = topOf([{ ...inv, creditNotes: [cn], payments: [{ amount: 200, paidAt: NOV(6) }] }], inNov);
  assert.deepEqual([r.t.partsSales, r.t.laborSales], [200, 0]);
  assert.deepEqual(r.items, { "Brake pads": 200 });
  // Issued under v0.3.29: labour 36.25 at 6% stored SST 2.17 (read back as 36.17).
  const old = issuedJob("JO", [padsItem(100), labourItem(36.25)], 6, "LABOR", true);
  assert.deepEqual([old.totalAmount, old.taxAmount], [138.42, 2.17]);
  const oldCn = splitNote({ labor: 36.25, parts: 0 }, NOV(5), undefined, old);
  const o = topOf([{ ...old, creditNotes: [oldCn], payments: [{ amount: 100, paidAt: NOV(6) }] }], inNov);
  assert.deepEqual([o.t.partsSales, o.t.laborSales], [100, 0]);
  assert.deepEqual(o.items, { "Brake pads": 100 });
  // A parts-only note of a few sen (no SST) is still parts.
  const job = { partsC: 20000, laborC: 10000, taxRate: 8, laborLines: 1 };
  assert.deepEqual(splitMixSen({ taxAmount: 0 }, 15, job, 20000, 10000), { parts: 15, labor: 0 });
  assert.deepEqual(splitMixSen({ taxAmount: 8 }, 10806, { ...job, laborC: 10006 }, 20000, 10006), { parts: 0, labor: 10006 });
});

test("top selling, labour-only SST: free parts on a job without split notes keep their quantity", () => {
  const a = issuedJob("JA", [
    { id: "W", type: "LABOR", description: "Wheel balancing", costPrice: 0, quantity: 1, total: 40 },
    { id: "V", type: "PART", description: "Valve cap", costPrice: 0, quantity: 4, total: 0 },
  ], 8, "LABOR");
  assert.equal(a.totalAmount, 43.2);
  const b = issuedJob("JB", [{ id: "V", type: "PART", description: "Valve cap", costPrice: 0, quantity: 4, total: 8 }], 0, "ALL");
  const jobs = [
    { ...a, payments: [{ amount: 43.2, paidAt: NOV(5) }] },
    { ...b, payments: [{ amount: 8, paidAt: NOV(6) }] },
  ];
  const units = itemSales(jobs, periodTotals(jobs, inNov).perJob);
  // Was × 4: the free caps on the labour-only SST job were dropped.
  assert.deepEqual(units.get("Valve cap"), { quantity: 8, sales: 8 });
});

test("revenue mix, labour-only SST: a split note's real small parts stay parts; labour never above the note's net", () => {
  // Pads 200 + bulb 1.50 + 10 labour lines of 15, 6% on labour only: 360.50 / SST 9.
  const labours = Array.from({ length: 10 }, (_, i) => labourItem(15, `L${i}`));
  const bulb = { id: "B", type: "PART", description: "Bulb", costPrice: 0, quantity: 1, total: 1.5 };
  const inv = issuedJob("JB", [padsItem(), bulb, ...labours], 6, "LABOR");
  assert.deepEqual([inv.totalAmount, inv.taxAmount], [360.5, 9]);
  const cn = splitNote({ labor: 150, parts: 1.5 }, NOV(5), undefined, inv);
  assert.deepEqual([cn.amount, cn.taxAmount], [160.5, 9]);
  const r = topOf([{ ...inv, creditNotes: [cn], payments: [{ amount: 200, paidAt: NOV(6) }] }], inNov);
  // Was parts 201.50 against 200 collected (the bulb was booked as labour).
  assert.deepEqual([r.t.collections, r.t.partsSales, r.t.laborSales], [200, 200, 0]);

  // Pads 200 + labour 100 at 8%: two labour splits whose SST reads back high (28.50, 41.75).
  const pl = issuedJob("JP", [padsItem(), labourItem()], 8, "LABOR");
  const a = splitNote({ labor: 28.45, parts: 0 }, NOV(3), undefined, pl);
  const b = splitNote({ labor: 41.69, parts: 0 }, NOV(4), { amount: a.amount, tax: a.taxAmount }, pl);
  assert.deepEqual([a.amount, a.taxAmount, b.amount, b.taxAmount], [30.73, 2.28, 45.03, 3.34]);
  const t = periodTotals([{ ...pl, creditNotes: [a, b], payments: [{ amount: 232.24, paidAt: NOV(6) }] }], inNov);
  // Was labour 29.75 (mix 232.13 against 232.24 collected).
  assert.deepEqual([t.collections, t.partsSales, t.laborSales, t.sst], [232.24, 200, 29.86, 2.38]);
  // splitMixSen: only a note that took all the SST left gets the per-line allowance.
  const job = { partsC: 20150, laborC: 15000, taxRate: 6, laborLines: 10 };
  assert.deepEqual(splitMixSen({ taxAmount: 9 }, 16050, job, 20150, 15000, 900), { parts: 150, labor: 15000 });
  assert.deepEqual(splitMixSen({ taxAmount: 4.5 }, 8000, job, 20150, 15000, 900), { parts: 50, labor: 7500 });
});

// Boss reports (pure, integer sen): money is counted when it is received, from the Payment ledger.
// - Collections of a period = every Payment row paid in it (a refund is a negative row), not the
//   job's last payment date, so a job paid half in October and half in November counts in both.
// - SST and parts cost follow the job-page rules (order-profit.mjs: SST after credit notes, parts
//   returned to stock no longer a cost). They are earned as the job is paid: after each payment or
//   credit note (in date order) the job has earned "SST and cost still on it × share of what is owed
//   that has been paid", and each period gets the change caused by its own payments / credit notes.
//   So a refund or credit note in November never changes October, and over all periods the job ends
//   at its job-page figures: a fully credited job keeps the cost of parts that never went back to stock.
// - Operating expenses = expenses recorded on the Expenses page + payment vouchers that do not pay a
//   supplier invoice (rent, utilities, wages paid by voucher) + delivery / service charges on supplier
//   invoices. Voided entries never count. The stock lines of a supplier invoice are purchases: that
//   cost is counted as parts cost when the part is sold, so paying the invoice is not an expense.
// 【中文】老板报表（以分计算）：收款按实际收款记录（Payment，退款为负数）算到收款当月；SST 和零件成本按工单页同一规则，随收款和退款单（按日期先后）逐步计入，每个期间只算自己那段时间的变化，所以之后的退款不会改动已经过去的月份；整张退掉但零件没放回库存的，零件成本照样算。营业开支 = 开支页记录 + 不是付供应商发票的付款凭证；作废的不算；付供应商发票是进货，成本在零件卖出时算。
import { toCents } from "./money-core.mjs";
import { jobProfit, returnedStockCost } from "./order-profit.mjs";

const SAFE = Number.MAX_SAFE_INTEGER / 100;
const sen = (n) => {
  const v = Number(n) || 0;
  return Math.abs(v) > SAFE ? Math.round(v * 100) : toCents(v);
};
const toDate = (x) => {
  const d = x instanceof Date ? x : new Date(x);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * SST and parts cost a job has earned (sen) once `st` has been paid and credited.
 * Share paid = paid ÷ (total − credited + cash rounding), at most all of it. With nothing left to
 * pay (fully credited) no SST is owed, but parts that were not put back on the shelf are still a cost.
 */
function earnedSen(job, st) {
  const netTotalC = job.totalC - st.creditedC;
  const netCostC = job.costC - st.returnedC;
  // Nothing left to pay (fully credited, or the last sen covered by a negative cash rounding, the
  // same rule as amountDueCents / refundLimits): no SST, but parts not put back are still a cost.
  // 【中文】已经不用再付（全部退掉，或剩下的 1–2 分被付款时的进位抵掉，与 amountDueCents / refundLimits 同一规则）：不算 SST，但没放回库存的零件照样算成本。
  const dueC = netTotalC + job.roundingC;
  if (netTotalC <= 0 || dueC <= 0) return { sst: 0, cost: netCostC, parts: 0, labor: 0 };
  const share = Math.min(1, Math.max(0, st.paidC / dueC));
  const netTaxC = Math.max(0, job.taxC - st.creditedTaxC);
  // Revenue mix: the parts and labour still on the bill (before discount and SST) × share paid.
  const netPartsC = Math.max(0, job.partsC - st.creditedPartsC);
  const netLaborC = Math.max(0, job.laborC - st.creditedLaborC);
  return {
    sst: Math.round(netTaxC * share),
    cost: Math.round(netCostC * share),
    parts: Math.round(netPartsC * share),
    labor: Math.round(netLaborC * share),
  };
}

/**
 * Parts and labour (sen, before discount and SST) that a credit note without lines takes off an
 * invoice with SST on labour only. Such a note is a split note (labour and parts typed separately)
 * or the whole remainder (credit-calc.mjs allows nothing else): its SST is labour × rate, so the
 * labour it credited is SST × 100 ÷ rate and the rest of the amount (less SST) is parts. Those are
 * after the invoice discount (the split boxes work on net amounts), while the bill's parts and
 * labour and a credited line's total are before it, so both are grossed up by
 * (parts + labour) ÷ (parts + labour − discount): the discount is shared by line value whatever the
 * type, so one ratio fits both. Each is capped at what is still left of that type.
 * Shared by the revenue mix (jobPeriodSen) and Top Selling (itemSales), so the two always agree.
 * @param {{ taxAmount?: number | null }} cn
 * @param {number} creditC the note's amount (sen)
 * @param {{ partsC: number; laborC: number; discountC?: number; taxRate: number; laborLines?: number }} job parts / labour / discount (sen),
 *   SST % and the number of labour lines (each rounded its own SST)
 * @param {number} leftPartsC parts still on the bill (sen, before discount)
 * @param {number} leftLaborC labour still on the bill (sen, before discount)
 * @param {number} [taxLeftC] SST still on the bill before this note (sen); left out, the note is taken to close it
 * @returns {{ parts: number; labor: number }} sen, before discount
 */
// 【中文】只对工钱收 SST 的发票上，没有明细的退款单（拆分退款或退掉全部余额）扣掉的零件和工钱（以分计，折扣前）：
// 退掉的工钱 = SST × 100 ÷ 税率，金额减 SST 减工钱是零件。这两个数是折扣后的，账单上的零件、工钱和按行退的金额是折扣前的，
// 所以按（零件 + 工钱）÷（零件 + 工钱 − 折扣）换回折扣前（折扣按行金额分摊，两种类型比例相同），再各自不超过剩下的。营收结构和热销项目共用，两边一致。
export function splitMixSen(cn, creditC, job, leftPartsC, leftLaborC, taxLeftC) {
  const taxC = Math.max(0, sen(cn.taxAmount));
  let laborNet = job.taxRate > 0 ? Math.round((taxC * 100) / job.taxRate) : 0;
  // Labour read back from the SST can also come out a few sen above the note's net: never more
  // labour than the note credited before SST.
  // 【中文】用 SST 反推的工钱也可能比退款单的净额多几分：工钱不超过退款单扣掉 SST 后的金额。
  laborNet = Math.min(laborNet, Math.max(0, creditC - taxC));
  let partsNet = Math.max(0, creditC - taxC - laborNet);
  const grossC = Math.max(0, job.partsC) + Math.max(0, job.laborC);
  const netC = grossC - Math.min(grossC, Math.max(0, job.discountC || 0));
  const up = (v) => (netC > 0 && netC < grossC ? Math.round((v * grossC) / netC) : v);
  // SST is rounded to the sen (1 sen of SST is 12.5 sen of labour at 8%), so labour read back from it
  // can fall a few sen short: such a remainder is labour, not parts. A sen per labour line only when
  // the note took all the SST left (the close-out, where each line's rounding adds up); otherwise one
  // sen. Never when the labour would be more than is left, so real small parts stay parts. Only for
  // a note with SST, so a parts-only note of a few sen stays parts.
  // 【中文】SST 只精确到分（8% 时 1 分 SST 相当于 12.5 分工钱），用 SST 反推的工钱可能少几分：这点零头算工钱，不算零件。只有退掉全部剩下 SST 的退款单才按工钱行数放宽，其他只放宽 1 分；算成工钱后超过剩下的工钱就不算，真退的小零件仍算零件。几分钱的纯零件退款仍算零件。
  const tookAll = taxLeftC == null || taxC >= taxLeftC;
  const tol = job.taxRate > 0 ? Math.ceil(((tookAll ? 0.5 + Math.max(1, job.laborLines || 1) : 1) * 100) / job.taxRate) : 0;
  if (taxC > 0 && partsNet > 0 && partsNet <= tol && up(laborNet + partsNet) <= leftLaborC) {
    laborNet = creditC - taxC;
    partsNet = 0;
  }
  return {
    parts: Math.max(0, Math.min(leftPartsC, up(partsNet))),
    labor: Math.max(0, Math.min(leftLaborC, up(laborNet))),
  };
}

/**
 * Parts and labour a credit note takes off the bill (sen, before discount and SST): its lines by
 * type. A note without lines on an invoice with labour-only SST is a split note or the whole
 * remainder: its SST tells its labour from its parts (splitMixSen). Any other note without lines
 * (an amount only) takes the same share of the parts and labour still on the bill as of the job's
 * remaining total. That share already took part of a line credited later, so (except with
 * labour-only SST, where line credits are kept as they are, as in itemSales) a line credit takes no
 * more of a type than is still left of it, and the excess comes off the other type.
 * @param {{ lines?: Array<{ workOrderItemId?: string | null; type?: string | null; total?: number | null }>; taxAmount?: number | null }} cn
 * @param {number} creditC the note's amount (sen)
 * @param {Map<string, string>} typeOf item id → "PART" / "LABOR"
 * @param {{ totalC: number; taxC: number; partsC: number; laborC: number; discountC: number; taxRate: number; taxScope: string }} job
 * @param {{ creditedC: number; creditedTaxC: number; creditedPartsC: number; creditedLaborC: number }} st before this note
 */
// 【中文】退款单从账单扣掉的零件和工钱（以分计，折扣和 SST 之前）：按它的明细行分类；只对工钱收 SST 的发票，没有明细的退款单是「工钱 + 零件」拆分退款（或退掉全部余额），
// 用它的 SST 分出工钱和零件（splitMixSen，已换回折扣前）；其他只有金额没有明细的，按剩余总额的比例从剩下的零件和工钱里扣。
function creditedMixSen(cn, creditC, typeOf, job, st) {
  const lines = Array.isArray(cn.lines) ? cn.lines : [];
  if (lines.length) {
    let parts = 0;
    let labor = 0;
    for (const l of lines) {
      const type = String(l.type || (l.workOrderItemId ? typeOf.get(l.workOrderItemId) : "") || "").toUpperCase();
      const v = sen(l.total);
      if (type === "PART") parts += v;
      else if (type === "LABOR") labor += v;
    }
    // Labour-only SST jobs keep line credits as they are (itemSales does the same).
    if (job.taxScope === "LABOR" && job.taxRate > 0 && job.taxC > 0) return { parts, labor };
    // A type cannot lose more than is still left of it; the excess comes off the other type
    // (an earlier amount-only note already took its pro-rata share of this line).
    // 【中文】一种类型扣掉的不能多于它剩下的；多出的从另一种扣（之前只填金额的退款单已按比例扣过这一行的一部分）。只对工钱收 SST 的工单照原样扣（与热销项目一致）。
    const leftP = Math.max(0, job.partsC - st.creditedPartsC);
    const leftL = Math.max(0, job.laborC - st.creditedLaborC);
    const exP = Math.max(0, parts - leftP);
    const exL = Math.max(0, labor - leftL);
    return { parts: Math.min(leftP, Math.min(parts, leftP) + exL), labor: Math.min(leftL, Math.min(labor, leftL) + exP) };
  }
  const leftC = job.totalC - st.creditedC;
  if (leftC <= 0 || creditC <= 0) return { parts: 0, labor: 0 };
  const leftPartsC = Math.max(0, job.partsC - st.creditedPartsC);
  const leftLaborC = Math.max(0, job.laborC - st.creditedLaborC);
  // Labour-only SST (the only non-line credits such an invoice allows are split notes and the
  // whole remainder, credit-calc.mjs): the note's SST tells how much labour it credited.
  if (job.taxScope === "LABOR" && job.taxRate > 0 && job.taxC > 0) {
    return splitMixSen(cn, creditC, job, leftPartsC, leftLaborC, Math.max(0, job.taxC - st.creditedTaxC));
  }
  const f = Math.min(1, creditC / leftC);
  return {
    parts: Math.round(leftPartsC * f),
    labor: Math.round(leftLaborC * f),
  };
}

/**
 * One job's figures for a period (sen), from its whole history of payments and credit notes.
 * Revenue mix (parts / labour sales) follows the same events: what each payment or credit note
 * changes in "parts and labour still on the bill × share paid", so a part credited back stops
 * counting as sold and a refund for it comes off parts, not off labour (on a labour-only SST
 * invoice, a split credit note's labour and parts are told apart by its SST, see splitMixSen).
 * @param {{ totalAmount: number; taxAmount: number; roundingAdjustment?: number | null;
 *   partsAmount?: number; laborAmount?: number; discount?: number | null; taxRate?: number | null; taxScope?: string | null;
 *   items: Array<{ id: string; costPrice: number; quantity: number; type?: string | null }>;
 *   creditNotes: Array<{ amount: number; taxAmount: number; createdAt: Date | string;
 *     lines?: Array<{ workOrderItemId?: string | null; returnedToStock?: number | null; type?: string | null; total?: number | null }> }>;
 *   payments: Array<{ amount: number; paidAt: Date | string }> }} o
 * @param {(at: Date) => boolean} inPeriod
 * @returns {{ collected: number; received: number; refunds: number; sst: number; partsCost: number;
 *   partsSales: number; laborSales: number; payments: number; events: number }} sen (payments / events are counts)
 */
// 【中文】一张工单在某期间的数字（以分计）：按全部收款和退款单的先后顺序，只把这个期间里发生的变化算进来。
export function jobPeriodSen(o, inPeriod) {
  const job = {
    totalC: sen(o.totalAmount),
    taxC: sen(o.taxAmount),
    roundingC: sen(o.roundingAdjustment || 0),
    costC: sen(jobProfit({ ...o, creditedAmount: 0, creditNotes: [] }).partsCost),
    partsC: sen(o.partsAmount),
    laborC: sen(o.laborAmount),
    discountC: sen(o.discount || 0),
    taxRate: Number(o.taxRate) || 0,
    taxScope: String(o.taxScope || ""),
    laborLines: (o.items || []).filter((i) => i.type === "LABOR").length,
  };
  const typeOf = new Map((o.items || []).map((i) => [String(i.id), String(i.type || "")]));
  const events = [];
  for (const p of o.payments || []) {
    const at = toDate(p.paidAt);
    if (at) events.push({ at, kind: 1, paidC: sen(p.amount) });
  }
  for (const cn of o.creditNotes || []) {
    // A credit note without a date is taken as the oldest event, so the final figures stay right.
    events.push({
      at: toDate(cn.createdAt) || new Date(0),
      kind: 0,
      cn,
      creditC: sen(cn.amount),
      taxC: sen(cn.taxAmount),
      returnedC: sen(returnedStockCost(o.items || [], [cn])),
    });
  }
  // Same moment: the credit note first, then its refund.
  events.sort((a, b) => a.at.getTime() - b.at.getTime() || a.kind - b.kind);

  const out = { collected: 0, received: 0, refunds: 0, sst: 0, partsCost: 0, partsSales: 0, laborSales: 0, payments: 0, events: 0 };
  const st = { paidC: 0, creditedC: 0, creditedTaxC: 0, returnedC: 0, creditedPartsC: 0, creditedLaborC: 0 };
  let prev = { sst: 0, cost: 0, parts: 0, labor: 0 };
  for (const e of events) {
    if (e.kind === 1) st.paidC += e.paidC;
    else {
      const mix = creditedMixSen(e.cn, e.creditC, typeOf, job, st);
      st.creditedC += e.creditC;
      st.creditedTaxC += e.taxC;
      st.returnedC += e.returnedC;
      st.creditedPartsC += mix.parts;
      st.creditedLaborC += mix.labor;
    }
    const now = earnedSen(job, st);
    if (inPeriod(e.at)) {
      out.events++;
      out.sst += now.sst - prev.sst;
      out.partsCost += now.cost - prev.cost;
      out.partsSales += now.parts - prev.parts;
      out.laborSales += now.labor - prev.labor;
      if (e.kind === 1) {
        out.payments++;
        out.collected += e.paidC;
        if (e.paidC >= 0) out.received += e.paidC;
        else out.refunds -= e.paidC;
      }
    }
    prev = now;
  }
  return out;
}

/**
 * Totals of a period from the Payment ledger and credit notes. Each job must carry ALL its payments
 * and credit notes (not only the period's), so the share already paid before the period is known.
 * @param {Array<{ id: string; totalAmount: number; taxAmount: number; roundingAdjustment?: number | null;
 *   partsAmount?: number; laborAmount?: number; items: Array<{ id: string; costPrice: number; quantity: number; type?: string | null }>;
 *   creditNotes: Array<{ amount: number; taxAmount: number; createdAt: Date | string;
 *     lines?: Array<{ workOrderItemId?: string | null; returnedToStock?: number | null; type?: string | null; total?: number | null }> }>;
 *   payments: Array<{ amount: number; paidAt: Date | string }> }>} jobs
 * @param {(at: Date) => boolean} inPeriod
 * @returns {{ collections: number; received: number; refunds: number; sst: number; partsCost: number; partsSales: number;
 *   laborSales: number; grossProfit: number; paidJobs: number; perJob: Array<{ id: string; collected: number }> }} RM
 */
// 【中文】按收款记录和退款单算一个期间的合计（RM）：收款、退款、SST、零件成本、毛利、有收款的工单数。每张工单要带上全部收款和退款单。
export function periodTotals(jobs, inPeriod) {
  let collections = 0;
  let received = 0;
  let refunds = 0;
  let sst = 0;
  let partsCost = 0;
  let partsSales = 0;
  let laborSales = 0;
  const perJob = [];
  for (const o of jobs) {
    const r = jobPeriodSen(o, inPeriod);
    if (!r.events) continue;
    collections += r.collected;
    received += r.received;
    refunds += r.refunds;
    sst += r.sst;
    partsCost += r.partsCost;
    partsSales += r.partsSales;
    laborSales += r.laborSales;
    if (r.payments) perJob.push({ id: o.id, collected: r.collected / 100 });
  }
  return {
    collections: collections / 100,
    received: received / 100,
    refunds: refunds / 100,
    sst: sst / 100,
    partsCost: partsCost / 100,
    partsSales: partsSales / 100,
    laborSales: laborSales / 100,
    grossProfit: (collections - sst - partsCost) / 100,
    paidJobs: perJob.filter((j) => j.collected > 0).length,
    perJob,
  };
}

/**
 * Top selling work items of a period (RM, by item description): a job counts by the share of it
 * collected in the period (`perJob` from periodTotals), so a job paid over two months is split
 * between them. Units and value a credit note took back by line are left out (a part returned and
 * credited is not "sold"), and the share is of what is still owed after those credits. On an
 * invoice with SST on labour only, a note without lines (split note or the whole remainder) is told
 * apart into labour and parts by its SST, the same way as in the revenue mix (splitMixSen): it takes
 * that labour off the labour items and those parts off the part items (each item of a type keeps
 * the same fraction), and the share is of what is owed after it. Any other note without lines
 * (amount only) names no item: it lowers the share instead, the same share off every item, as in the
 * revenue mix.
 * @param {Array<{ id: string; totalAmount: number; taxAmount: number; roundingAdjustment?: number | null;
 *   taxRate?: number | null; taxScope?: string | null; discount?: number | null;
 *   items: Array<{ id: string; description: string; quantity: number; total: number; type?: string | null }>;
 *   creditNotes: Array<{ amount: number; taxAmount: number;
 *     lines?: Array<{ workOrderItemId?: string | null; quantity?: number | null; total?: number | null }> }> }>} jobs
 * @param {Array<{ id: string; collected: number }>} perJob RM collected per job in the period
 * @returns {Map<string, { quantity: number; sales: number }>}
 */
// 【中文】期间热销项目（RM，按项目名称）：工单按本期间收到的比例计入（跨月付清的分摊到各月）；按明细行退回的数量和金额不算卖出，
// 比例按扣掉这些退款之后的应收额计算。只对工钱收 SST 的发票，没有明细的退款单（拆分退款或退掉全部余额）和营收结构一样用 SST 分出工钱和零件（splitMixSen），
// 从工钱项目扣工钱、从零件项目扣零件（同一类型的项目扣同样的比例）。其他只有金额没有明细的退款单不指明项目，改为降低比例，每个项目扣同样的比例，和营收结构一致。
export function itemSales(jobs, perJob) {
  const jobById = new Map(jobs.map((o) => [o.id, o]));
  /** @type {Map<string, { quantity: number; sales: number }>} */
  const totals = new Map();
  for (const j of perJob) {
    const o = jobById.get(j.id);
    if (!o || j.collected <= 0) continue;
    const notes = o.creditNotes || [];
    const items = o.items || [];
    // Labour-only SST: a note without lines says by its SST which type it credited, so it takes
    // value off that type below, like a line credit. Same test as jobPeriodSen.
    const labourSst = o.taxScope === "LABOR" && Number(o.taxRate) > 0 && sen(o.taxAmount) > 0;
    const typed = (cn) => (cn.lines || []).length > 0 || labourSst;
    // Notes that take value off the items below; other (amount-only) notes lower the share instead.
    const typedCredited = notes.reduce((sum, cn) => sum + (typed(cn) ? cn.amount : 0), 0);
    const netDue = o.totalAmount - typedCredited + (o.roundingAdjustment || 0);
    if (netDue <= 0) continue;
    const share = Math.min(1, j.collected / netDue);
    const creditedQty = new Map();
    const creditedTotal = new Map();
    for (const cn of notes) {
      for (const l of cn.lines || []) {
        if (!l.workOrderItemId) continue;
        creditedQty.set(l.workOrderItemId, (creditedQty.get(l.workOrderItemId) || 0) + (l.quantity || 0));
        creditedTotal.set(l.workOrderItemId, (creditedTotal.get(l.workOrderItemId) || 0) + (l.total || 0));
      }
    }
    const typeOf = (item) => (item.type === "LABOR" ? "LABOR" : "PART");
    const left = items.map((item) => ({
      q: Math.max(0, item.quantity - (creditedQty.get(item.id) || 0)),
      t: Math.max(0, item.total - (creditedTotal.get(item.id) || 0)),
    }));
    // Fraction of each type still sold after the split notes (labour-only SST only).
    const keep = { PART: 1, LABOR: 1 };
    if (labourSst) {
      const grossC = { PART: 0, LABOR: 0 };
      const leftC = { PART: 0, LABOR: 0 };
      items.forEach((item, k) => {
        grossC[typeOf(item)] += sen(item.total);
        leftC[typeOf(item)] += sen(left[k].t);
      });
      const job = {
        partsC: grossC.PART,
        laborC: grossC.LABOR,
        discountC: sen(o.discount || 0),
        taxRate: Number(o.taxRate),
        laborLines: items.filter((i) => i.type === "LABOR").length,
      };
      const taken = { PART: 0, LABOR: 0 };
      // SST taken by the notes before each one (in the order given, notes with lines too).
      // 【中文】每张退款单之前已退的 SST（按给定顺序，含有明细的退款单）。
      let taxUsed = 0;
      for (const cn of notes) {
        const taxLeft = Math.max(0, sen(o.taxAmount) - taxUsed);
        taxUsed += sen(cn.taxAmount);
        if ((cn.lines || []).length) continue;
        const m = splitMixSen(cn, sen(cn.amount), job, leftC.PART - taken.PART, leftC.LABOR - taken.LABOR, taxLeft);
        taken.PART += m.parts;
        taken.LABOR += m.labor;
      }
      for (const ty of /** @type {const} */ (["PART", "LABOR"])) {
        // A type with nothing left (all RM0 items, such as free valve caps) lost nothing to a split
        // note (splitMixSen caps at what is left), so its items keep their quantities.
        // 【中文】某类型剩下 0 元（例如全是免费零件）时，拆分退款扣不到它，它的项目数量照样计入。
        keep[ty] = leftC[ty] > 0 ? Math.max(0, 1 - taken[ty] / leftC[ty]) : 1;
      }
    }
    items.forEach((item, k) => {
      const f = keep[typeOf(item)];
      const q = left[k].q * f;
      const t = left[k].t * f;
      if (q <= 0.0005 && t <= 0.005) return;
      const old = totals.get(item.description) || { quantity: 0, sales: 0 };
      totals.set(item.description, { quantity: old.quantity + q * share, sales: old.sales + t * share });
    });
  }
  return totals;
}

/**
 * Operating expenses of a period: Expenses-page entries, payment vouchers that are not
 * supplier-invoice payments, the delivery / service charges on supplier invoices (lines that
 * never went into stock, so they never become parts cost), and the tax on supplier invoices (parts
 * cost uses the price before tax, and a workshop cannot claim this tax back, so it is counted here
 * by invoice date). Voided rows never count.
 * @param {{ expenses: Array<{ amount: number; voidedAt?: Date | string | null }>;
 *   vouchers: Array<{ amount: number; voidedAt?: Date | string | null; supplierInvoiceId?: string | null }>;
 *   supplierCharges?: Array<{ total: number }>;
 *   supplierTax?: Array<{ taxAmount: number; voidedAt?: Date | string | null }> }} p
 * @returns {{ expenses: number; vouchers: number; supplierCharges: number; supplierTax: number; total: number }} RM
 */
// 【中文】期间营业开支：开支页记录 + 不是付供应商发票的付款凭证 + 供应商发票上的运费 / 服务费（不入库存，不会变成零件成本）+ 供应商发票上的税（零件成本按税前价算，这笔税不能抵扣，按发票日期算进开支）；作废的不算。
export function operatingExpenses(p) {
  const e = (p.expenses || []).filter((x) => !x.voidedAt).reduce((s, x) => s + sen(x.amount), 0);
  const v = (p.vouchers || []).filter((x) => !x.voidedAt && !x.supplierInvoiceId).reduce((s, x) => s + sen(x.amount), 0);
  const c = (p.supplierCharges || []).reduce((s, x) => s + sen(x.total), 0);
  const t = (p.supplierTax || []).filter((x) => !x.voidedAt).reduce((s, x) => s + sen(x.taxAmount), 0);
  return { expenses: e / 100, vouchers: v / 100, supplierCharges: c / 100, supplierTax: t / 100, total: (e + v + c + t) / 100 };
}

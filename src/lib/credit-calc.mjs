// Credit-note arithmetic (pure, shared by the API route, the credit-note panel preview and tests).
// - SST on a credit note follows what is credited, at the invoice's own rate and scope
//   (computeTotals). With SST on labour only, crediting a part credits no SST.
// - Refund limits allow for the cash rounding taken at payment: a bill of 100.02 settled as
//   100.00 (rounding -0.02) can be fully credited and the whole 100.00 refunded.
// - Worked out with the rounding the invoice was issued with (computeIssuedTotals): an invoice
//   issued under v0.3.29 or earlier keeps that version's rounding, so crediting all of it credits
//   exactly its stored total and SST, and the credited lines' SST is the SST those lines carried.
// All comparisons are done in integer sen.
// 【中文】退款单计算（纯函数）：SST 按实际退的行、用原发票的税率和范围计算（只收工钱税时退零件不退税）；退款上限考虑付款时的 5 分进位，四舍五入少收的单也能全额退。
// 【中文】按原发票开票时的四舍五入方法计算：v0.3.29 及以前开的发票用旧方法，全额退时金额和 SST 刚好等于发票上存的。
import { toCents, fromCents, roundMoney } from "./money-core.mjs";
import { computeIssuedTotals, computeTotalsWithRounding } from "./tax-core.mjs";
import { roundQty } from "./stock-calc.mjs";

const QTY_EPS = 0.0005;

/**
 * Largest amount accepted from a typed box (RM 10 million, same cap as a line's unit price):
 * far above any workshop bill and far below where sen arithmetic would throw.
 */
export const MAX_INPUT_AMOUNT = 10_000_000;

/**
 * A typed amount the money helpers can safely work with (blank / not a number counts as 0,
 * the same way the panel and the route read the boxes).
 * @param {unknown} value
 */
// 【中文】输入的金额是否在安全范围内（最多 RM 1000 万）：粘贴一长串数字不会让页面崩溃或服务器出 500。
export function isSaneAmount(value) {
  const n = Number(value) || 0;
  return Number.isFinite(n) && Math.abs(n) <= MAX_INPUT_AMOUNT;
}

/**
 * Share of `value` that belongs to units prev..prev+q of a line of `qty` units, so that the
 * shares of several partial credits add up exactly to `value` once the whole line is credited.
 */
function slice(value, prev, q, qty) {
  const upTo = (n) => (n >= qty - QTY_EPS ? toCents(value) : Math.round((toCents(value) * n) / qty));
  return fromCents(upTo(prev + q) - upTo(prev));
}

/**
 * The invoice's own lines, worked out the way the invoice was issued (its stored SST tells
 * whether that was with v0.3.29's rounding). `rounding` is then used for what is credited.
 * 【中文】按开票时的方法重算原发票各行（看存下来的 SST 判断是不是 v0.3.29 的旧四舍五入），退的部分也用同一方法。
 */
function issuedBase(inv, rate, scope) {
  return computeIssuedTotals(inv.items, inv.discount, rate, scope, inv.taxAmount);
}

/**
 * Labour and parts (after the invoice discount, before SST) still to be credited, in sen, and the
 * SST still on those labour lines. Lines credited by earlier credit notes come off their own type.
 * Earlier amount-only / split notes do not say which they were, so they only count against the
 * invoice total and (for labour-only SST) against the SST still left — see computeCreditNote.
 */
function leftByTypeCents(inv, base, creditedQty) {
  let labor = 0;
  let parts = 0;
  let laborTax = 0;
  inv.items.forEach((it, k) => {
    const qty = roundQty(it.quantity);
    const done = Math.min(qty, roundQty((creditedQty || {})[it.id] || 0));
    const creditedNet = toCents(slice(it.total, 0, done, qty)) - toCents(slice(base.lines[k].discountShare, 0, done, qty));
    const left = toCents(base.lines[k].net) - creditedNet;
    if (it.type === "LABOR") {
      labor += left;
      laborTax += toCents(base.lines[k].tax) - toCents(slice(base.lines[k].tax, 0, done, qty));
    } else parts += left;
  });
  return { labor: Math.max(0, labor), parts: Math.max(0, parts), laborTax: Math.max(0, laborTax) };
}

/**
 * Labour and parts still to be credited (RM), shown beside the split boxes. Besides lines
 * credited earlier, the hint also allows for earlier amount-only / split notes: nothing more
 * than the net still left, and with labour-only SST no more labour than the SST still left covers.
 * @param {{ invoice: { totalAmount: number; taxAmount: number; taxRate: number; taxScope: string; discount: number;
 *   items: Array<{ id: string; type: string; quantity: number; total: number }> };
 *   creditedAmount: number; creditedTax: number; creditedQty?: Record<string, number> }} p
 */
// 【中文】这张发票还可以退的工钱、零件金额（折扣后、未含 SST）：已按行退过的扣掉；之前只填金额/拆分退过的，按剩下的金额和剩下的 SST 再限制。
export function splitLeft(p) {
  const inv = p.invoice;
  const rate = Number(inv.taxRate) || 0;
  const scope = inv.taxScope === "LABOR" ? "LABOR" : "ALL";
  const left = leftByTypeCents(inv, issuedBase(inv, rate, scope), p.creditedQty);
  const taxLeftC = Math.max(0, toCents(inv.taxAmount) - toCents(p.creditedTax || 0));
  const netLeftC = Math.max(0, toCents(inv.totalAmount) - toCents(p.creditedAmount || 0) - taxLeftC);
  let labor = Math.min(left.labor, netLeftC);
  // Only when earlier notes took more SST than the labour lines credited by line carried: the SST
  // left then estimates the labour left. While it still covers the SST on the labour lines left,
  // all that labour is left (SST 2.17 at 6% gave 36.17 for a labour line of 36.25 or 36.24).
  // 【中文】只有之前的退款单退掉的 SST 比按行退的多时，才用剩下的 SST 估算剩下的工钱；否则剩下的工钱就是各工钱行剩下的（以前 36.25 的工钱显示成 36.17）。
  if (scope === "LABOR" && rate > 0 && toCents(inv.taxAmount) > 0 && taxLeftC < left.laborTax) {
    labor = Math.min(labor, Math.round((taxLeftC * 100) / rate));
  }
  let parts = Math.min(left.parts, netLeftC);
  // Labour-only SST: earlier split notes do not say what they credited, but the net still left
  // less the labour still left (read from the SST left, above) is the parts still left. Without
  // this, parts credited by an earlier split note were offered again (RM 180 left of RM 200 parts
  // after crediting RM 120 of them).
  // 【中文】只对工钱收 SST 时：之前的拆分退款没说退的是哪种，剩下的净额减剩下的工钱（上面用剩下的 SST 估算）就是剩下的零件；以前拆分退过的零件会被再算一次。
  if (scope === "LABOR" && rate > 0 && toCents(inv.taxAmount) > 0) parts = Math.min(parts, Math.max(0, netLeftC - labor));
  return { labor: fromCents(labor), parts: fromCents(parts) };
}

/**
 * Amount still due on an invoice, in sen: total + cash rounding taken − credited − paid.
 * Same rule as refundLimits: once the whole invoice is credited nothing is due, even if a positive
 * rounding (customer paid 0.02 extra) is still on record — that extra went back with the refund.
 * Used by the payment route and the work-order page so the three cannot drift apart again.
 * @param {{ totalAmount: number; roundingAdjustment?: number | null; creditedAmount?: number | null; paidAmount?: number | null }} p
 */
// 【中文】发票还欠多少（以分计）：总额 + 付款进位 − 已退 − 已付；整张发票已全部退款时一律为 0（与 refundLimits 同一规则）。
export function amountDueCents(p) {
  const T = toCents(p.totalAmount);
  const C = toCents(p.creditedAmount || 0);
  if (C >= T) return 0;
  return Math.max(0, T + toCents(p.roundingAdjustment || 0) - C - toCents(p.paidAmount || 0));
}

/**
 * Credit, refund and amount-still-due limits for one credit note.
 * @param {{ totalAmount: number; creditedAmount: number; paidAmount: number; roundingAdjustment?: number; amount: number; refundAmount?: number }} p
 */
// 【中文】退款单金额、退钱金额的上下限（以分计算）：全额退时，付款时的进位也一起抵消，客户已付的钱可以全部退回。
export function refundLimits(p) {
  // A pasted 15-digit number must give an error, not a RangeError that blanks the page.
  const tooBig = !isSaneAmount(p.amount) || !isSaneAmount(p.refundAmount);
  const T = toCents(p.totalAmount);
  const C = toCents(p.creditedAmount);
  const P = toCents(p.paidAmount);
  const R = toCents(p.roundingAdjustment || 0);
  const A = tooBig ? 0 : toCents(p.amount);
  const F = tooBig ? 0 : toCents(p.refundAmount || 0);

  const maxCredit = Math.max(0, T - C);
  const newC = C + A;
  const fullyCredited = newC >= T;
  // Once the whole invoice is credited nothing is left to round, so nothing is due.
  const dueAfter = fullyCredited ? 0 : Math.max(0, T + R - newC);
  const minRefund = Math.max(0, P - dueAfter);
  // A positive rounding (customer paid 0.02 extra) goes back too when everything is credited.
  const maxRefund = Math.min(P, A + (fullyCredited ? Math.max(0, R) : 0));

  let error = null;
  if (tooBig) error = "Amount is too large";
  else if (!(A > 0)) error = "Enter the amount to credit";
  else if (A > maxCredit) error = `Maximum that can still be credited is RM ${fromCents(maxCredit).toFixed(2)}`;
  else if (F < 0) error = "Refund cannot be negative";
  else if (F > P) error = `Cannot refund more than was paid (RM ${fromCents(P).toFixed(2)})`;
  else if (F > maxRefund) error = "Refund cannot be more than the credit amount";
  else if (F < minRefund) {
    error = `Customer would have paid RM ${fromCents(P - F - dueAfter).toFixed(2)} too much. Refund at least RM ${fromCents(minRefund).toFixed(2)}.`;
  }
  return {
    ok: !error,
    error,
    maxCredit: fromCents(maxCredit),
    minRefund: fromCents(minRefund),
    maxRefund: fromCents(Math.max(0, maxRefund)),
    dueAfter: fromCents(dueAfter),
    newCredited: fromCents(newC),
    newPaid: fromCents(P - F),
    fullyCredited,
  };
}

/**
 * Work out a credit note's amount (incl. SST) and SST.
 * mode "lines":  credit chosen invoice lines (itemId + quantity), with the invoice's discount share.
 * mode "split":  goodwill / price correction stated as labour and parts amounts before SST.
 * mode "amount": a single amount incl. SST; SST pro-rata — only allowed when SST covers every line
 *                (scope ALL) or the invoice has no SST, because pro-rata is wrong for labour-only SST.
 * @param {{
 *   invoice: { totalAmount: number; taxAmount: number; taxRate: number; taxScope: string; discount: number;
 *              items: Array<{ id: string; type: string; quantity: number; total: number }> };
 *   creditedAmount: number; creditedTax: number; creditedQty?: Record<string, number>;
 *   mode: "lines" | "split" | "amount";
 *   lines?: Array<{ itemId: string; quantity: number }>;
 *   split?: { labor: number; parts: number };
 *   amount?: number;
 * }} p
 */
// 【中文】算退款单金额和 SST：按行退 / 按工钱+零件拆分退 / 只填金额（只有全部收税或没收税时才按比例算税）。
export function computeCreditNote(p) {
  const inv = p.invoice;
  const rate = Number(inv.taxRate) || 0;
  const scope = inv.taxScope === "LABOR" ? "LABOR" : "ALL";
  const remainingC = Math.max(0, toCents(inv.totalAmount) - toCents(p.creditedAmount));
  const remainingTaxC = Math.max(0, toCents(inv.taxAmount) - toCents(p.creditedTax || 0));
  const fail = (error, code) => ({ ok: false, error, code: code || null });

  let amountC = 0;
  let taxC = 0;
  let closesInvoice = false;
  const lines = [];

  if (p.mode === "lines") {
    const picks = Array.isArray(p.lines) ? p.lines : [];
    if (!picks.length) return fail("Pick at least one invoice line to credit");
    const base = issuedBase(inv, rate, scope);
    const index = new Map(inv.items.map((it, k) => [it.id, k]));
    const qtyNow = new Map(inv.items.map((it) => [it.id, roundQty((p.creditedQty || {})[it.id] || 0)]));
    const seen = new Set();
    const credited = [];
    const lineTax = [];
    let discount = 0;
    for (const pick of picks) {
      const k = index.get(pick.itemId);
      if (k === undefined) return fail("A credited line is not on this invoice");
      if (seen.has(pick.itemId)) return fail("Each invoice line can only be picked once");
      seen.add(pick.itemId);
      const it = inv.items[k];
      const qty = roundQty(it.quantity);
      const q = roundQty(pick.quantity);
      const prev = Math.min(qty, qtyNow.get(it.id) || 0);
      if (!(q > 0)) return fail("Credited quantity must be more than 0");
      if (q > roundQty(qty - prev) + QTY_EPS) return fail("Credited quantity is more than what is left on the invoice line");
      const value = slice(it.total, prev, q, qty);
      const disc = slice(base.lines[k].discountShare, prev, q, qty);
      qtyNow.set(it.id, roundQty(prev + q));
      discount = roundMoney(discount + disc);
      credited.push({ itemId: it.id, type: it.type === "LABOR" ? "LABOR" : "PART", quantity: q, total: value });
      lineTax.push(slice(base.lines[k].tax, prev, q, qty));
    }
    // Same rounding as the invoice. Each credited line's SST is its share of the SST that line
    // carried on the invoice (sliced like its discount share), so partial credits of one line add up
    // exactly to that line's SST: SST worked out afresh on each slice could round up a sen each time
    // and leave the last unit of a labour line refused as "already credited".
    // 【中文】和发票同一种四舍五入。每行退的 SST 取该行在发票上 SST 的相应份额（和折扣份额一样切分），分几次退同一行，SST 加起来刚好等于该行的 SST；以前每次重新算会每次多进 1 分，最后一小时被当成已经退过而拒绝。
    const t = computeTotalsWithRounding(base.rounding, credited, discount, rate, scope);
    credited.forEach((c, j) => lines.push({ ...c, net: t.lines[j].net, taxAmount: lineTax[j] }));
    taxC = lineTax.reduce((s, x) => s + toCents(x), 0);
    amountC = toCents(t.totalAmount) - toCents(t.taxAmount) + taxC;
    closesInvoice = inv.items.every((it) => (qtyNow.get(it.id) || 0) >= roundQty(it.quantity) - QTY_EPS);
    // Labour-only SST: labour credited by an earlier split note took its SST with it, so a labour
    // line carrying more SST than is still left (a sen per labour line for rounding) was already
    // credited. Capping the SST quietly gave a note whose lines no longer matched its SST. Line SST is
    // sliced from the invoice line (above), so this only fires when a note without lines took it.
    // 【中文】只对工钱收 SST 时：之前拆分退过的工钱已经带走了它的 SST；按行退的工钱 SST 多于剩下的 SST（每行容许 1 分进位差），说明这些工钱已经退过。各行 SST 已按发票行切分，所以只有之前没有明细的退款单拿走了 SST 才会触发。
    if (scope === "LABOR" && !closesInvoice && taxC > remainingTaxC + inv.items.filter((it) => it.type === "LABOR").length) {
      return fail("Labour amount is more than the labour still to be credited on this invoice", "SPLIT_OVER_LIMIT");
    }
    // Labour-only SST: parts an earlier split note took are not in creditedQty, so a part line is
    // also checked against the parts splitLeft shows, with the same allowance as split mode. Without
    // this, crediting the pads line after a split of parts credited RM 250 of parts on RM 200.
    // 【中文】只对工钱收 SST 时：之前拆分退过的零件不算在按行退的数量里，所以按行退零件也要不超过 splitLeft 显示的剩余零件（余量与拆分退款相同）；以前 200 元的零件可以退 250 元。
    if (scope === "LABOR" && !closesInvoice && rate > 0 && toCents(inv.taxAmount) > 0) {
      const nLab = inv.items.filter((it) => it.type === "LABOR").length;
      const partsC = lines.reduce((s, l) => s + (l.type === "PART" ? toCents(l.net) : 0), 0);
      if (partsC > toCents(splitLeft(p).parts) + Math.ceil(((nLab + 1) * 100) / rate)) {
        return fail("Parts amount is more than the parts still to be credited on this invoice", "SPLIT_OVER_LIMIT");
      }
    }
  } else if (p.mode === "split") {
    if (!isSaneAmount(p.split?.labor) || !isSaneAmount(p.split?.parts)) return fail("Amount is too large");
    const labor = roundMoney(Number(p.split?.labor) || 0);
    const parts = roundMoney(Number(p.split?.parts) || 0);
    if (labor < 0 || parts < 0) return fail("Amounts cannot be negative");
    if (!(labor + parts > 0)) return fail("Enter the amount to credit");
    // Never more labour / parts than the invoice still has, so what LHDN gets as taxed and
    // untaxed matches what was typed (labour 150 on a labour-100 invoice used to pass).
    const base = issuedBase(inv, rate, scope);
    const left = leftByTypeCents(inv, base, p.creditedQty);
    if (toCents(labor) > left.labor) return fail("Labour amount is more than the labour still to be credited on this invoice", "SPLIT_OVER_LIMIT");
    if (toCents(parts) > left.parts) return fail("Parts amount is more than the parts still to be credited on this invoice", "SPLIT_OVER_LIMIT");
    // Labour-only SST: parts an earlier split note took are not in `left`, so parts are also capped
    // at what splitLeft shows (net left less labour left). Labour read back from the SST left can be
    // a few sen off per labour line after earlier labour splits, hence the allowance.
    // 【中文】只对工钱收 SST 时：之前拆分退过的零件不在 left 里，所以零件还要不超过 splitLeft 显示的剩余零件；用剩下的 SST 估算工钱每行可能差几分，留一点余量。
    if (scope === "LABOR" && rate > 0 && toCents(inv.taxAmount) > 0) {
      const nLab = inv.items.filter((it) => it.type === "LABOR").length;
      const cap = toCents(splitLeft(p).parts) + Math.ceil(((nLab + 1) * 100) / rate);
      if (toCents(parts) > cap) return fail("Parts amount is more than the parts still to be credited on this invoice", "SPLIT_OVER_LIMIT");
    }
    const t = computeTotalsWithRounding(
      base.rounding,
      [{ type: "LABOR", total: labor }, { type: "PART", total: parts }],
      0, rate, scope
    );
    taxC = toCents(t.taxAmount);
    // Labour-only SST: the SST still left is the labour still left, including labour credited
    // by earlier amount-only / split notes. A few sen of slack for per-line rounding.
    const slack = inv.items.filter((it) => it.type === "LABOR").length;
    if (scope === "LABOR" && taxC > remainingTaxC + slack) {
      return fail("Labour amount is more than the labour still to be credited on this invoice", "SPLIT_OVER_LIMIT");
    }
    // The credit is labour + parts + SST. When the SST is capped at what is left (sen rounding),
    // the amount drops with it, so amount − SST always equals the labour + parts typed.
    taxC = Math.min(taxC, remainingTaxC);
    amountC = toCents(labor) + toCents(parts) + taxC;
    // Typing all of the net still left (the "Left to credit" figures) credits everything left: close
    // the invoice exactly with all the SST left. SST worked out on the combined labour can be a sen
    // below the labour lines' own, which used to leave 1 sen of SST that nothing could credit.
    // 【中文】填的工钱 + 零件刚好等于剩下的净额（即按「剩余可退」填）就是全部退掉：金额和 SST 都等于剩下的，不再留下 1 分 SST 退不掉。
    if (toCents(labor) + toCents(parts) === remainingC - remainingTaxC) {
      amountC = remainingC;
      taxC = remainingTaxC;
    }
  } else {
    if (!isSaneAmount(p.amount)) return fail("Amount is too large");
    const amount = roundMoney(Number(p.amount) || 0);
    if (!(amount > 0)) return fail("Enter the amount to credit");
    // Crediting everything that is left is fine in any scope (all remaining SST goes with it).
    if (scope === "LABOR" && toCents(inv.taxAmount) > 0 && toCents(amount) !== remainingC) {
      return fail(
        "SST on this invoice is charged on labour only. Pick the invoice lines being credited, or split the amount into labour and parts.",
        "SPLIT_REQUIRED"
      );
    }
    amountC = toCents(amount);
    const totalC = toCents(inv.totalAmount);
    taxC = totalC > 0 ? Math.round((amountC * toCents(inv.taxAmount)) / totalC) : 0;
  }

  if (closesInvoice) {
    // Every invoice line is now credited: close the invoice exactly (absorbs sen rounding
    // and any earlier amount-only credit).
    amountC = remainingC;
  } else if (amountC > remainingC) {
    return fail(`Maximum that can still be credited is RM ${fromCents(remainingC).toFixed(2)}`);
  }
  if (amountC <= 0) return fail("Nothing is left to credit on this invoice");
  // Crediting everything that is left credits all SST that is left.
  taxC = amountC === remainingC ? remainingTaxC : Math.min(taxC, remainingTaxC, amountC);
  // Safety net: a note never carries more SST than its amount (that would send LHDN a negative base).
  // 【中文】保底检查：退款单的 SST 不能多于它的金额（否则送给 LHDN 的应税金额是负数）。
  if (taxC > amountC) return fail("The SST left on this invoice is more than the amount left to credit");

  return {
    ok: true,
    error: null,
    code: null,
    amount: fromCents(amountC),
    taxAmount: fromCents(taxC),
    closesInvoice: amountC === remainingC,
    lines,
  };
}

// Boss-only job cost and gross profit (pure, integer sen). Parts a credit note put back on the
// shelf are no longer a cost of the job, so their cost comes off. SST belongs to Customs (JKDM),
// so it is never profit; SST credited back comes off the SST too.
// The dashboard and reports can use returnedStockCost() the same way.
// 【中文】老板看的工单成本和毛利（以分计算）：退款单"放回库存"的零件不再算这张工单的成本；SST 属于海关，不算利润。
import { toCents } from "./money-core.mjs";

const SAFE = Number.MAX_SAFE_INTEGER / 100;
// toCents refuses absurd values; a page must still render, so those just round plainly.
const sen = (n) => {
  const v = Number(n) || 0;
  return Math.abs(v) > SAFE ? Math.round(v * 100) : toCents(v);
};

/**
 * Cost of every job line (cost price × quantity, rounded per line), in sen.
 * @param {Array<{ costPrice: number; quantity: number }>} items
 */
function itemsCostSen(items) {
  return items.reduce((s, i) => s + sen((Number(i.costPrice) || 0) * (Number(i.quantity) || 0)), 0);
}

/**
 * Cost of the units credit notes returned to stock: returnedToStock × the job line's cost price.
 * @param {Array<{ id: string; costPrice: number }>} items
 * @param {Array<{ lines?: Array<{ workOrderItemId?: string | null; returnedToStock?: number | null }> }>} creditNotes
 */
function returnedSen(items, creditNotes) {
  const cost = new Map(items.map((i) => [i.id, Number(i.costPrice) || 0]));
  let total = 0;
  for (const cn of creditNotes || []) {
    for (const l of cn.lines || []) {
      const q = Number(l.returnedToStock) || 0;
      if (q > 0 && l.workOrderItemId && cost.has(l.workOrderItemId)) total += sen(cost.get(l.workOrderItemId) * q);
    }
  }
  return total;
}

/**
 * Cost (RM) of parts that credit notes put back on the shelf.
 * @param {Array<{ id: string; costPrice: number }>} items
 * @param {Array<{ lines?: Array<{ workOrderItemId?: string | null; returnedToStock?: number | null }> }>} creditNotes
 */
// 【中文】退款单放回库存的零件成本（RM）。
export function returnedStockCost(items, creditNotes) {
  return returnedSen(items, creditNotes) / 100;
}

/**
 * Parts cost, cost of returned parts, net cost and gross profit of one job.
 * Gross profit = (total − credited) − (SST − SST credited) − (parts cost − returned parts cost).
 * @param {{ totalAmount: number; creditedAmount: number; taxAmount: number;
 *   items: Array<{ id: string; costPrice: number; quantity: number }>;
 *   creditNotes: Array<{ taxAmount: number; lines?: Array<{ workOrderItemId?: string | null; returnedToStock?: number | null }> }> }} o
 */
// 【中文】一张工单的零件成本、放回库存的成本、净成本和毛利。
export function jobProfit(o) {
  const partsCost = itemsCostSen(o.items);
  const returned = returnedSen(o.items, o.creditNotes);
  const netCost = partsCost - returned;
  const creditedTax = (o.creditNotes || []).reduce((s, cn) => s + sen(cn.taxAmount), 0);
  const grossProfit = sen(o.totalAmount) - sen(o.creditedAmount) - (sen(o.taxAmount) - creditedTax) - netCost;
  return {
    partsCost: partsCost / 100,
    returnedCost: returned / 100,
    netCost: netCost / 100,
    grossProfit: grossProfit / 100,
  };
}

/**
 * Estimated SST collected on a job so far (RM): SST still on the invoice after credit notes (each
 * note records the SST it really credited, by the invoice's tax scope) × the share of what is
 * still owed that has been paid. With labour-only SST, crediting a part takes no SST off, so a
 * pro-rata guess on the original total would under-state the SST owed to Customs (JKDM).
 * @param {{ totalAmount: number; creditedAmount: number; taxAmount: number; paidAmount: number;
 *   creditNotes: Array<{ taxAmount: number }> }} o
 */
// 【中文】这张工单目前已收的 SST 估算（RM）：发票 SST 减去各退款单实际退的 SST，再按"已付 / 退款后应付"的比例计算。
export function sstCollected(o) {
  const netTotal = sen(o.totalAmount) - sen(o.creditedAmount);
  if (netTotal <= 0) return 0;
  const creditedTax = (o.creditNotes || []).reduce((s, cn) => s + sen(cn.taxAmount), 0);
  const netTax = Math.max(0, sen(o.taxAmount) - creditedTax);
  const share = Math.min(1, Math.max(0, sen(o.paidAmount) / netTotal));
  return (netTax * share) / 100;
}

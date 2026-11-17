// Stock taken for a job, worked out from the job's own stock movements.
// Since v0.3.29 parts are taken off stock when the INVOICE is issued, not when the quote is
// made. Older jobs already took some (or all) stock at quote time, so the invoice only takes
// what is still outstanding: line quantity − net already taken for that job and item.
// 【中文】开发票时才扣库存：只扣"还没扣的部分" = 工单数量 − 这张工单对该零件已扣的净数量（旧工单报价时已扣过的不会重复扣）。

/** Quantities are Float (0.5 L of oil): keep 3 decimals so 0.1 + 0.2 does not leave 0.30000000000000004. */
export function roundQty(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

/**
 * Total quantity per inventory item over the PART lines linked to inventory.
 * @param {Array<{ type: string; quantity: number; inventoryItemId?: string | null }>} items
 * @returns {Map<string, number>}
 */
export function neededByItem(items) {
  const need = new Map();
  for (const it of items) {
    if (it.type !== "PART" || !it.inventoryItemId) continue;
    need.set(it.inventoryItemId, roundQty((need.get(it.inventoryItemId) || 0) + (Number(it.quantity) || 0)));
  }
  return need;
}

/**
 * Net quantity a job has taken per item: −(sum of its movements). OUT movements are negative,
 * returns / cancellations positive, so this is what the job still holds.
 * @param {Array<{ inventoryItemId: string; quantity: number }>} movements
 * @returns {Map<string, number>}
 */
export function takenByItem(movements) {
  const taken = new Map();
  for (const m of movements) {
    taken.set(m.inventoryItemId, roundQty((taken.get(m.inventoryItemId) || 0) - (Number(m.quantity) || 0)));
  }
  return taken;
}

/**
 * What the invoice must take off stock for each linked item.
 * `short` > 0 means there is not enough on hand for the outstanding quantity.
 * Items that no longer exist in inventory are skipped.
 * @param {Array<{ type: string; quantity: number; inventoryItemId?: string | null }>} items
 * @param {Array<{ inventoryItemId: string; quantity: number }>} movements  this job's movements
 * @param {Array<{ id: string; quantityOnHand: number; name?: string; sku?: string | null }>} inventory
 */
// 【中文】算出开发票时每个零件要扣多少（outstanding），以及库存不够的数量（short）。
export function planInvoiceStock(items, movements, inventory) {
  const need = neededByItem(items);
  const taken = takenByItem(movements);
  const byId = new Map(inventory.map((i) => [i.id, i]));
  const plan = [];
  for (const [inventoryItemId, needed] of need) {
    const inv = byId.get(inventoryItemId);
    if (!inv) continue;
    const already = Math.max(0, taken.get(inventoryItemId) || 0);
    const outstanding = Math.max(0, roundQty(needed - already));
    const onHand = roundQty(inv.quantityOnHand);
    const short = Math.max(0, roundQty(outstanding - Math.max(0, onHand)));
    plan.push({ inventoryItemId, name: inv.name ?? "", sku: inv.sku ?? null, needed, alreadyTaken: already, outstanding, onHand, short });
  }
  return plan;
}

/**
 * How much of an item a credit note may put back on the shelf for this job: never more than
 * the job still holds (net taken), so stock is not created out of nothing.
 * @param {Array<{ inventoryItemId: string; quantity: number }>} movements  this job's movements
 * @param {string} inventoryItemId
 */
export function returnableQty(movements, inventoryItemId) {
  return Math.max(0, takenByItem(movements).get(inventoryItemId) || 0);
}

/**
 * Whether a manual stock change (Stock In / Stock Out / Adjust) may be saved. Since "Invoice
 * anyway" can leave on-hand below zero (parts owed), only a REDUCTION that would end below zero
 * is refused: receiving 2 of 3 owed parts (−3 + 2 = −1) must still be recorded.
 * @param {number} onHand
 * @param {number} delta
 */
// 【中文】手动进货/出货/调整能不能保存：库存可能因"照样开发票"变成负数，所以只拦"减少后低于 0"的；欠 3 个到货 2 个（−3+2=−1）也能进货。
export function stockChangeAllowed(onHand, delta) {
  const d = Number(delta) || 0;
  if (d >= 0) return true;
  return roundQty((Number(onHand) || 0) + d) >= 0;
}

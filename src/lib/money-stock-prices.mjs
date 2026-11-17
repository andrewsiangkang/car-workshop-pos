// Stock prices and supplier invoices (pure, integer sen).
// A supplier invoice overwrites the inventory item's cost price (and its selling price when one is
// typed). The previous prices are kept on each invoice line (SupplierInvoiceItem.prevCostPrice /
// prevSellingPrice). Voiding the invoice puts them back, but only while the item still carries
// the prices this invoice set: when a later supplier invoice or a manual edit changed them since,
// they are left alone and the audit log says why.
// 【中文】供应商发票会改库存的成本价（填了售价也会改售价）。录入时把原来的价格记在发票行上；作废时放回去——但只有库存价格仍是这张发票设定的才放回；之后有别的发票或手动改过，就保持不变并在审计日志说明。
import { toCents } from "./money-core.mjs";

const same = (a, b) => toCents(a) === toCents(b);

/**
 * True when an inventory audit entry (its details JSON) shows a cost or selling price change.
 * Newer entries carry { before, after } of the changed fields; older ones a list "changedFields"
 * (the old edit form always sent the selling price, so those count as a change to be safe).
 * @param {string | null | undefined} details
 */
// 【中文】这条库存审计记录是否改了成本价或售价（旧记录只有字段名单，保守地当作改过）。
export function auditShowsPriceEdit(details) {
  if (!details) return false;
  let d;
  try {
    d = JSON.parse(details);
  } catch {
    // Cut-off (over-long) details: cannot tell, so treat as changed.
    return /costPrice|sellingPrice/.test(details);
  }
  if (!d || typeof d !== "object") return false;
  const after = d.after && typeof d.after === "object" ? d.after : null;
  if (after && ("costPrice" in after || "sellingPrice" in after)) return true;
  const fields = Array.isArray(d.changedFields) ? d.changedFields : [];
  return fields.includes("costPrice") || fields.includes("sellingPrice");
}

/**
 * What voiding a supplier invoice does to each inventory item's prices.
 * @param {{
 *   lines: Array<{ inventoryItemId: string | null; unitCost: number; prevCostPrice: number | null; prevSellingPrice: number | null }>;
 *   items: Array<{ id: string; name: string; costPrice: number; sellingPrice: number }>;
 *   changedLater?: Iterable<string>;
 * }} p lines in the invoice's order; changedLater = items whose prices a later (not voided)
 *   supplier invoice or a manual edit changed after this invoice
 * @returns {Array<{ inventoryItemId: string; name: string;
 *   cost: { action: "restore" | "keep" | "none"; current: number; to: number | null; reason: string };
 *   selling: { action: "restore" | "keep" | "none"; current: number; to: number | null; reason: string } }>}
 */
// 【中文】作废供应商发票时，每个库存项目的成本价 / 售价怎么处理：放回原价、保持不变（之后改过）或不用处理。
export function planPriceRestore(p) {
  const later = new Set(p.changedLater || []);
  const byItem = new Map();
  for (const l of p.lines || []) {
    if (!l.inventoryItemId) continue;
    const list = byItem.get(l.inventoryItemId) || [];
    list.push(l);
    byItem.set(l.inventoryItemId, list);
  }
  const out = [];
  for (const item of p.items || []) {
    const lines = byItem.get(item.id);
    if (!lines || !lines.length) continue;
    const firstPrevCost = lines[0].prevCostPrice;
    const setCost = lines[lines.length - 1].unitCost;
    const prevSellLine = lines.find((l) => l.prevSellingPrice !== null && l.prevSellingPrice !== undefined);
    const changedLater = later.has(item.id);
    const costChangedSince = !same(item.costPrice, setCost);

    let cost;
    if (firstPrevCost === null || firstPrevCost === undefined) {
      cost = { action: "none", current: item.costPrice, to: null, reason: "no_previous_price" };
    } else if (changedLater) {
      cost = { action: "keep", current: item.costPrice, to: firstPrevCost, reason: "changed_later" };
    } else if (costChangedSince) {
      cost = { action: "keep", current: item.costPrice, to: firstPrevCost, reason: "changed_since" };
    } else if (same(item.costPrice, firstPrevCost)) {
      cost = { action: "none", current: item.costPrice, to: firstPrevCost, reason: "unchanged" };
    } else {
      cost = { action: "restore", current: item.costPrice, to: firstPrevCost, reason: "restored" };
    }

    let selling;
    if (!prevSellLine) {
      selling = { action: "none", current: item.sellingPrice, to: null, reason: "not_changed_by_invoice" };
    } else if (changedLater) {
      selling = { action: "keep", current: item.sellingPrice, to: prevSellLine.prevSellingPrice, reason: "changed_later" };
    } else if (costChangedSince) {
      // The cost this invoice set was changed since, so its selling price may have been too.
      selling = { action: "keep", current: item.sellingPrice, to: prevSellLine.prevSellingPrice, reason: "changed_since" };
    } else if (same(item.sellingPrice, prevSellLine.prevSellingPrice)) {
      selling = { action: "none", current: item.sellingPrice, to: prevSellLine.prevSellingPrice, reason: "unchanged" };
    } else {
      selling = { action: "restore", current: item.sellingPrice, to: prevSellLine.prevSellingPrice, reason: "restored" };
    }
    out.push({ inventoryItemId: item.id, name: item.name, cost, selling });
  }
  return out;
}

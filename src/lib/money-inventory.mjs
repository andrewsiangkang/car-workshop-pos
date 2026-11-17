// Inventory items are never deleted: "Delete" archives them, so their stock-movement history stays
// (7-year record keeping). Pure rules shared by the API and tests.
// 【中文】库存项目不会真的删除："删除"改为归档，进出库记录全部保留（7 年账目要求）。
import { roundQty } from "./stock-calc.mjs";

/**
 * Job statuses that can still take parts off stock: quotations, open work, and jobs marked Completed
 * before their invoice was generated (parts leave stock when the invoice is generated). The query
 * also requires "no invoice yet", so invoiced Completed jobs never block archiving.
 */
// 【中文】还会扣库存的工单状态：报价、进行中，以及已标"完成"但还没开发票的（开发票时才扣库存）。
export const OPEN_JOB_STATUSES = ["DRAFT", "QUOTED", "CONFIRMED", "IN_PROGRESS", "COMPLETED"];

/**
 * Can this item be archived?
 * @param {{ quantityOnHand: number; archivedAt?: Date | string | null }} item
 * @param {Array<{ orderNumber: string }>} openJobs quotations / jobs not yet invoiced (and not cancelled) that use it
 * @returns {{ ok: true } | { ok: false; code: "ALREADY_ARCHIVED" | "STOCK_NOT_ZERO" | "OPEN_QUOTATIONS"; error: string }}
 */
// 【中文】能不能归档：库存不是 0、或者有还没开发票的报价单 / 工单在用，就不能归档。
export function archiveCheck(item, openJobs) {
  if (item.archivedAt) return { ok: false, code: "ALREADY_ARCHIVED", error: "This item is already archived" };
  const qty = roundQty(Number(item.quantityOnHand) || 0);
  if (qty !== 0) {
    return {
      ok: false,
      code: "STOCK_NOT_ZERO",
      error: `Stock on hand is ${qty}. Bring it to 0 with a stock adjustment before archiving (stock below 0 means parts are still owed).`,
    };
  }
  const jobs = [...new Set((openJobs || []).map((j) => j.orderNumber))];
  if (jobs.length) {
    const list = jobs.slice(0, 5).join(", ") + (jobs.length > 5 ? ` (+${jobs.length - 5} more)` : "");
    return {
      ok: false,
      code: "OPEN_QUOTATIONS",
      error: `This item is on quotations / jobs not yet invoiced: ${list}. Invoice, cancel or change them first.`,
    };
  }
  return { ok: true };
}

/**
 * Which items the inventory list shows: active ones by default; "show archived" adds the archived.
 * @param {"active" | "all" | "archived"} mode
 */
// 【中文】库存列表显示哪些：默认只显示在用的；勾"显示已归档"时连归档的一起显示。
export function archivedWhere(mode) {
  if (mode === "all") return {};
  if (mode === "archived") return { archivedAt: { not: null } };
  return { archivedAt: null };
}

/**
 * Parts on a job being invoiced that are archived (hidden) in Inventory. Invoicing would take a
 * hidden item below zero, so the invoice waits until the boss restores them. Returns the message,
 * or null when nothing archived is used.
 * @param {Array<{ inventoryItemId: string; name?: string; outstanding: number }>} plan rows from planInvoiceStock
 * @param {Array<{ id: string; name?: string; archivedAt?: Date | string | null }>} inventory
 */
// 【中文】要开发票的工单用到已归档的零件：先请老板恢复，再开发票（否则隐藏的项目会变成负库存）。
export function archivedOnInvoice(plan, inventory) {
  const archived = new Map((inventory || []).filter((i) => i.archivedAt).map((i) => [i.id, i]));
  const names = (plan || [])
    .filter((p) => p.outstanding > 0 && archived.has(p.inventoryItemId))
    .map((p) => p.name || archived.get(p.inventoryItemId)?.name || p.inventoryItemId);
  if (!names.length) return null;
  return `These parts are archived in Inventory: ${[...new Set(names)].join(", ")}. Ask the boss to restore them (Inventory, Show archived, Restore), then generate the invoice.`;
}

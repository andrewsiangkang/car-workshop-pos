export const OPEN_JOB_STATUSES: Array<"DRAFT" | "QUOTED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED">;
export function archiveCheck(
  item: { quantityOnHand: number; archivedAt?: Date | string | null },
  openJobs: Array<{ orderNumber: string }>
):
  | { ok: true }
  | { ok: false; code: "ALREADY_ARCHIVED" | "STOCK_NOT_ZERO" | "OPEN_QUOTATIONS"; error: string };
export function archivedWhere(
  mode: "active" | "all" | "archived"
): { archivedAt?: null | { not: null } };
export function archivedOnInvoice(
  plan: Array<{ inventoryItemId: string; name?: string; outstanding: number }>,
  inventory: Array<{ id: string; name?: string; archivedAt?: Date | string | null }>
): string | null;

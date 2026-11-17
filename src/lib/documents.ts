/** Document number helpers for Quotation / Invoice / Receipt */
import { myDateKey } from "@/lib/money-time.mjs";

/** Date part on the Malaysian calendar (UTC+8), like the sequential numbers in docnumber.ts. */
export function generateDocNumber(prefix: "QT" | "INV" | "RC" | "WO") {
  const datePart = myDateKey(new Date()).replace(/-/g, "");
  const random = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}${datePart}${random}`;
}

export const DOC_STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿",
  QUOTED: "已报价",
  CONFIRMED: "已确认",
  IN_PROGRESS: "施工中",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

export type DocumentType = "quotation" | "invoice" | "receipt";

export const DOC_TYPE_LABEL: Record<DocumentType, string> = {
  quotation: "报价单",
  invoice: "发票",
  receipt: "收据",
};

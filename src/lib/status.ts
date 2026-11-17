export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  QUOTED: "Quoted",
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const STATUS_COLOR: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  QUOTED: "bg-amber-50 text-amber-700",
  CONFIRMED: "bg-blue-50 text-blue-700",
  IN_PROGRESS: "bg-indigo-50 text-indigo-700",
  COMPLETED: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-red-50 text-red-700",
};

export const VALID_STATUSES = Object.keys(STATUS_LABEL);
export const PAYMENT_METHODS = ["CASH", "CARD", "TRANSFER", "TNG", "OTHER"];
export const PAYMENT_LABEL: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  TRANSFER: "Bank Transfer",
  TNG: "Touch 'n Go",
  OTHER: "Other",
};

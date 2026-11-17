export type PrintVisibility = {
  sstInvoice: boolean;
  shopAddress: boolean;
  shopPhone: boolean;
  shopEmail: boolean;
  taxIds: boolean;
  sstNumber: boolean;
  documentNumber: boolean;
  jobNumber: boolean;
  documentDate: boolean;
  customer: boolean;
  vehicle: boolean;
};
export function chargesSst(doc: { type: string; taxAmount?: number | null }): boolean;
export function printVisibility(
  settings: Record<string, unknown> | null | undefined,
  doc: { type: string; taxAmount?: number | null }
): PrintVisibility;
export function printableSstNumber(sstNumber: string | null | undefined): string | null;

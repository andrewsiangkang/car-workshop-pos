/** Buyer snapshots to write before a customer is anonymised (documents still inside the keeping period). */
export function snapshotsToFreeze(p: {
  customer: object;
  orders: Array<
    Record<string, unknown> & {
      id: string;
      docSnapshot?: string | null;
      creditNotes?: Array<{ id: string; createdAt: Date | string; docSnapshot?: string | null }>;
    }
  >;
  now: Date | number;
}): {
  orders: Array<{ id: string; docSnapshot: string }>;
  creditNotes: Array<{ id: string; docSnapshot: string }>;
};
/** Issued documents past the keeping period: buyer requests to clear and snapshots without their buyer. */
export function buyerDataToClear(p: {
  orders: Array<
    Record<string, unknown> & {
      id: string;
      docSnapshot?: string | null;
      creditNotes?: Array<{ id: string; createdAt: Date | string; docSnapshot?: string | null }>;
    }
  >;
  now: Date | number;
}): {
  orderIds: string[];
  orders: Array<{ id: string; docSnapshot: string }>;
  creditNotes: Array<{ id: string; docSnapshot: string }>;
};
/** Audit summary of one expired-buyer-data sweep (counts only); null when nothing was cleared and nothing failed. */
export function expiredBuyerDataSummary(r: { customers: number; documents: number; failed: number }): string | null;

export const BUYER_PRIVATE_FIELDS: string[];
export const CUSTOMER_PRIVATE_FIELDS: string[];
export function redactBuyerForList<T extends Record<string, unknown>>(order: T, owner: boolean): T;

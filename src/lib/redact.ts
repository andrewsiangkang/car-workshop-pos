/**
 * Helpers that remove boss-only numbers (cost price) from objects
 * before they are sent to non-owner users.
 */

type WithItems = { items?: Array<Record<string, unknown>> } & Record<string, unknown>;

export function redactOrder<T extends WithItems>(order: T, owner: boolean): T {
  if (owner || !order) return order;
  if (!Array.isArray(order.items)) return order;
  return {
    ...order,
    items: order.items.map((i) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { costPrice, ...rest } = i;
      return rest;
    }),
  };
}

export function redactInventoryItem<T extends Record<string, unknown>>(item: T, owner: boolean): T {
  if (owner) return item;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { costPrice, ...rest } = item;
  return rest as T;
}


/**
 * For LIST responses to staff: no buyer ID number, TIN, e-mail or address (privacy-redact.mjs).
 * 【中文】列表接口给员工时去掉买方身份证号、TIN、电邮和地址（规则见 privacy-redact.mjs）。
 */
export { redactBuyerForList } from "@/lib/privacy-redact.mjs";

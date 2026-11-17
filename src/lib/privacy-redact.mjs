// What staff may read in bulk (pure). 【中文】员工批量读取时要隐藏的个人资料（纯函数）。

/** Buyer fields on a work order that only the boss may read in bulk. */
export const BUYER_PRIVATE_FIELDS = [
  "buyerTin",
  "buyerIdNo",
  "buyerEmail",
  "buyerAddress",
  "buyerPostcode",
  "buyerCity",
  "buyerStateCode",
  // The frozen invoice particulars include the buyer's TIN and address.
  "docSnapshot",
];
/** Customer fields hidden the same way. */
export const CUSTOMER_PRIVATE_FIELDS = ["tin", "email", "address", "postcode", "city", "stateCode"];

/**
 * For LIST responses to staff: the buyer's ID number (NRIC / passport), TIN, e-mail and address
 * are removed (also from the linked customer and the frozen invoice particulars), so one staff
 * login cannot bulk-read everyone's identity and tax numbers. The buyer name and phone stay
 * (staff need them). The boss gets everything; the invoice page's owner-only details are unchanged.
 * 【中文】列表接口给员工时：去掉买方的身份证 / 护照号码、TIN、电邮和地址（保留名字和电话），员工无法批量读取；老板不受影响。
 * @template {Record<string, unknown>} T
 * @param {T} order
 * @param {boolean} owner
 * @returns {T}
 */
export function redactBuyerForList(order, owner) {
  if (owner || !order) return order;
  /** @type {Record<string, unknown>} */
  const out = { ...order };
  for (const f of BUYER_PRIVATE_FIELDS) if (f in out) out[f] = null;
  const customer = out.customer;
  if (customer && typeof customer === "object") {
    /** @type {Record<string, unknown>} */
    const c = { ...customer };
    for (const f of CUSTOMER_PRIVATE_FIELDS) if (f in c) c[f] = null;
    out.customer = c;
  }
  return /** @type {T} */ (out);
}

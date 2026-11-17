// What a printed invoice / receipt shows, given the boss's template settings.
// Pure functions, no imports: used by DocumentLayout and tests.
// 【中文】打印单据显示哪些资料：按老板的模板设置；但收了 SST 的发票 / 收据，法定资料一律印出，模板不能隐藏。

/**
 * True when the document is an invoice or receipt that charges SST (a tax invoice).
 * Quotations are not tax documents.
 * @param {{ type: string, taxAmount?: number | null }} doc
 */
export function chargesSst(doc) {
  return doc.type !== "quotation" && (Number(doc.taxAmount) || 0) > 0;
}

/**
 * Which parts to print. A template can hide any of them, except that an invoice / receipt that
 * charges SST always shows what an SST invoice must carry (Service Tax Regulations 2018): the
 * seller's address and SST registration number, the document number and date, and the
 * customer's name and address.
 * @param {Record<string, unknown> | null | undefined} settings documentSettings from Settings
 * @param {{ type: string, taxAmount?: number | null }} doc
 */
// 【中文】模板可以隐藏各项资料；但收了 SST 的发票 / 收据，SST 登记号、店铺地址、单号、日期、客户名字和地址一定印出。
export function printVisibility(settings, doc) {
  const s = settings || {};
  const on = (/** @type {unknown} */ v) => v !== false;
  const sst = chargesSst(doc);
  return {
    sstInvoice: sst,
    shopAddress: sst || on(s.showShopAddress),
    shopPhone: on(s.showShopPhone),
    shopEmail: on(s.showShopEmail),
    taxIds: on(s.showTaxIds), // TIN / BRN
    sstNumber: sst || on(s.showTaxIds),
    documentNumber: sst || on(s.showDocumentNumber),
    jobNumber: on(s.showJobNumber),
    documentDate: sst || on(s.showDocumentDate),
    customer: sst || on(s.showCustomer),
    vehicle: on(s.showVehicle),
  };
}

/**
 * SST number worth printing: set and not the "NA" placeholder.
 * @param {string | null | undefined} sstNumber
 */
export function printableSstNumber(sstNumber) {
  const v = String(sstNumber ?? "").trim();
  return v && v.toUpperCase() !== "NA" ? v : null;
}

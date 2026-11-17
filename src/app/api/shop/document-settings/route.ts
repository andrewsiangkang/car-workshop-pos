import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { auditFieldChanges, flattenSettings } from "@/lib/privacy-audit.mjs";

export const dynamic = "force-dynamic";
const DEFAULTS = {
  quotation: { heading: "QUOTATION", footer: "This quotation is valid for 7 days. Prices may be adjusted based on actual materials used.", showSignature: false },
  invoice: { heading: "INVOICE", footer: "Please make payment within 7 days. Thank you for your business!", showSignature: true },
  receipt: { heading: "RECEIPT", footer: "Thank you for your business. We look forward to serving you again!", showSignature: true, paper: "A5_LANDSCAPE" },
  showCustomer: true,
  showVehicle: true, logoPosition: "LEFT", logoWidth: 120, fontSize: "NORMAL",
  showShopAddress: true, showShopPhone: true, showShopEmail: true, showTaxIds: true,
  showDocumentNumber: true, showJobNumber: true, showDocumentDate: true,
  showItemQuantity: true, showItemUnitPrice: true, showPaymentQr: true,
};
type Section = Record<string, unknown>;
type SavedSettings = Record<string, unknown> & { quotation?: Section; invoice?: Section; receipt?: Section };

/** Saved template settings (JSON text) as an object; anything unreadable counts as "nothing saved". */
function parseSaved(text: string | null | undefined): SavedSettings {
  try {
    const v = text ? JSON.parse(text) : {};
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const section = (x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? (x as Section) : undefined);
    return { ...v, quotation: section(v.quotation), invoice: section(v.invoice), receipt: section(v.receipt) };
  } catch {
    return {};
  }
}

/** Saved settings on top of the defaults (each document section merged on its own). */
function effectiveSettings(text: string | null | undefined) {
  const saved = parseSaved(text);
  return {
    ...DEFAULTS,
    ...saved,
    quotation: { ...DEFAULTS.quotation, ...saved.quotation },
    invoice: { ...DEFAULTS.invoice, ...saved.invoice },
    receipt: { ...DEFAULTS.receipt, ...saved.receipt },
  };
}

export async function GET() {
  const denied = await requireOwner(); if (denied) return denied;
  const shop = await prisma.shopProfile.findFirst();
  return NextResponse.json({ ...effectiveSettings(shop?.documentSettings), logoUrl: shop?.logoUrl || null });
}
export async function PUT(request: Request) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const body = await request.json();
    const clean = {
      quotation: { heading: String(body.quotation?.heading || "QUOTATION").slice(0, 60), footer: String(body.quotation?.footer || "").slice(0, 500), showSignature: body.quotation?.showSignature === true },
      invoice: { heading: String(body.invoice?.heading || "INVOICE").slice(0, 60), footer: String(body.invoice?.footer || "").slice(0, 500), showSignature: body.invoice?.showSignature !== false },
      receipt: { heading: String(body.receipt?.heading || "RECEIPT").slice(0, 60), footer: String(body.receipt?.footer || "").slice(0, 500), showSignature: body.receipt?.showSignature !== false, paper: body.receipt?.paper === "A5_PORTRAIT" ? "A5_PORTRAIT" : "A5_LANDSCAPE" },
      showCustomer: body.showCustomer !== false,
      showVehicle: body.showVehicle !== false,
      logoPosition: ["LEFT", "CENTER", "RIGHT"].includes(body.logoPosition) ? body.logoPosition : "LEFT",
      logoWidth: [80, 120, 160, 200].includes(Number(body.logoWidth)) ? Number(body.logoWidth) : 120,
      fontSize: ["SMALL", "NORMAL", "LARGE"].includes(body.fontSize) ? body.fontSize : "NORMAL",
      showShopAddress: body.showShopAddress !== false, showShopPhone: body.showShopPhone !== false,
      showShopEmail: body.showShopEmail !== false, showTaxIds: body.showTaxIds !== false,
      showDocumentNumber: body.showDocumentNumber !== false, showJobNumber: body.showJobNumber !== false,
      showDocumentDate: body.showDocumentDate !== false, showItemQuantity: body.showItemQuantity !== false,
      showItemUnitPrice: body.showItemUnitPrice !== false, showPaymentQr: body.showPaymentQr !== false,
    };
    const logoUrl = typeof body.logoUrl === "string" && /^\/api\/files\/[A-Za-z0-9._-]+$/.test(body.logoUrl) ? body.logoUrl : null;
    const shop = await prisma.shopProfile.findFirst();
    if (!shop) return NextResponse.json({ error: "Please save shop profile first" }, { status: 400 });
    const updated = await prisma.shopProfile.update({ where: { id: shop.id }, data: { documentSettings: JSON.stringify(clean), logoUrl } });
    const actor = await getCurrentUser();
    // Before / after of each changed template setting (e.g. "invoice.footer", "showTaxIds").
    // 【中文】记录每个改动的模板设置（修改前 / 修改后）。
    const before = { ...flattenSettings(effectiveSettings(shop.documentSettings)), logoUrl: shop.logoUrl || null };
    const diff = auditFieldChanges(before, { ...flattenSettings(clean), logoUrl });
    if (actor && diff.changedFields.length) await writeAuditLog({ actor, request, action: "DOCUMENT_TEMPLATE_UPDATED", entityType: "ShopProfile", entityId: updated.id, summary: `Document print templates updated: ${diff.changedFields.join(", ")}`.slice(0, 240), details: diff });
    return NextResponse.json({ success: true, settings: clean });
  } catch (error) {
    console.error(error); return NextResponse.json({ error: "Unable to save document templates" }, { status: 500 });
  }
}

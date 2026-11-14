import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ShopProfile } from "@prisma/client";
import { MY_STATES } from "@/lib/my-states";
import { writeAuditLog } from "@/lib/audit";
import { revealSecret, sealSecret } from "@/lib/secret-box";
import { auditFieldChanges } from "@/lib/privacy-audit.mjs";

export const dynamic = "force-dynamic";

/**
 * Never send the MyInvois client secret back to the browser. A secret that was saved but
 * cannot be opened with this computer's key (e.g. the database came from another PC) is
 * reported as unreadable, so Settings asks the boss to type it in again.
 * 【中文】不把 MyInvois 密钥发给浏览器；已保存但本机钥匙解不开的密钥会提示老板重新输入。
 */
function publicShop(shop: ShopProfile) {
  const { myInvoisClientSecret, ...rest } = shop;
  const readable = !!revealSecret(myInvoisClientSecret);
  return { ...rest, hasMyInvoisSecret: readable, myInvoisSecretUnreadable: !!myInvoisClientSecret && !readable };
}

const str = (v: unknown, max = 500) => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s || null;
};

/** Payment QR must be an uploaded file or an https URL (no javascript:/data: etc.). */
function safeImageUrl(v: unknown) {
  const s = str(v, 1000);
  if (!s) return null;
  if (s.startsWith("/api/files/") || s.startsWith("/uploads/") || s.startsWith("https://")) return s;
  return null;
}

export async function GET() {
  const __denied = await requireOwner();
  if (__denied) return __denied;
  try {
    let shop = await prisma.shopProfile.findFirst();
    if (!shop) {
      shop = await prisma.shopProfile.create({
        data: {
          name: "My Workshop",
          nameMs: null,
          address: "",
          phone: "",
          email: "",
          tin: "",
          brn: "",
          sstNumber: "NA",
          receiptFooter: "Thank you for your business. We look forward to serving you again!",
        },
      });
    }
    return NextResponse.json(publicShop(shop));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load shop details" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const __denied = await requireOwner();
  if (__denied) return __denied;
  try {
    const actor = await getCurrentUser();
    const body = await request.json();
    const existing = await prisma.shopProfile.findFirst();

    const data = {
      name: str(body.name, 200) || existing?.name || "Workshop",
      countryCode: /^[A-Z]{2}$/.test(String(body.countryCode || "")) ? String(body.countryCode) : existing?.countryCode || "MY",
      currencyCode: /^[A-Z]{3}$/.test(String(body.currencyCode || "")) ? String(body.currencyCode) : existing?.currencyCode || "MYR",
      locale: ["en-MY", "zh-MY", "ms-MY", "en-SG", "en-AU", "en-GB", "en-US", "en-IN", "en-ID", "th-TH", "vi-VN", "ja-JP"].includes(String(body.locale)) ? String(body.locale) : existing?.locale || "en-MY",
      timeZone: typeof body.timeZone === "string" && body.timeZone.length <= 64 ? body.timeZone : existing?.timeZone || "Asia/Kuala_Lumpur",
      taxLabel: str(body.taxLabel, 30) || existing?.taxLabel || "SST",
      nameMs: str(body.nameMs, 200),
      address: str(body.address),
      city: str(body.city, 100),
      postcode: (str(body.postcode, 10) || "").replace(/\D/g, "").slice(0, 5) || null,
      stateCode: typeof body.stateCode === "string" && MY_STATES[body.stateCode] ? body.stateCode : null,
      phone: str(body.phone, 50),
      email: str(body.email, 200),
      tin: str(body.tin, 50)?.toUpperCase() ?? null,
      brn: str(body.brn, 50),
      sstNumber: str(body.sstNumber, 50) || "NA",
      sstRate: Math.min(100, Math.max(0, Number(body.sstRate) || 0)),
      sstScope: body.sstScope === "LABOR" ? "LABOR" : "ALL",
      msicCode: str(body.msicCode, 10),
      msicDesc: str(body.msicDesc, 300),
      myInvoisClientId: str(body.myInvoisClientId, 200),
      // Blank = keep the saved secret (the browser never receives it). A new one is stored
      // encrypted (secret-box, key kept outside the database).
      myInvoisClientSecret: sealSecret(str(body.myInvoisClientSecret, 200)) ?? existing?.myInvoisClientSecret ?? null,
      myInvoisSandbox: body.myInvoisSandbox !== false,
      bankName: str(body.bankName, 100),
      bankAccount: str(body.bankAccount, 50),
      paymentQrUrl: safeImageUrl(body.paymentQrUrl),
      receiptFooter: str(body.receiptFooter, 1000),
      documentSettings: typeof body.documentSettings === "string" ? body.documentSettings.slice(0, 12000) : existing?.documentSettings ?? null,
    };

    const shop = existing
      ? await prisma.shopProfile.update({ where: { id: existing.id }, data })
      : await prisma.shopProfile.create({ data });

    // Before / after values of what really changed. The MyInvois secret is only recorded as
    // "changed"; the bank account and MyInvois client ID only by their last 4 characters.
    // 【中文】记录真正改动的栏位（修改前 / 修改后）；MyInvois 密钥只记「已修改」，银行账号和 Client ID 只记最后 4 位。
    const diff = auditFieldChanges(existing as Record<string, unknown> | null, data, {
      hidden: ["myInvoisClientSecret"],
      masked: ["bankAccount", "myInvoisClientId"],
      opaque: ["documentSettings"],
    });
    if (actor && (diff.changedFields.length || !existing)) {
      await writeAuditLog({
        actor,
        request,
        action: "SHOP_SETTINGS_UPDATED",
        entityType: "ShopProfile",
        entityId: shop.id,
        summary: diff.changedFields.length ? `Workshop settings updated: ${diff.changedFields.join(", ")}`.slice(0, 240) : "Workshop settings created",
        details: diff,
      });
    }
    return NextResponse.json(publicShop(shop));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}

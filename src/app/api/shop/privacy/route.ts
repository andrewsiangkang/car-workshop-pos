import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { parseRetentionYears, RECORD_KEEPING_YEARS } from "@/lib/privacy-customer.mjs";

export const dynamic = "force-dynamic";

/** Settings → Privacy (boss only): how many years customer records are kept (null = off). */
// 【中文】设置 → 隐私（老板专用）：客户资料保留年限（空 = 关闭）。
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  const shop = await prisma.shopProfile.findFirst({ select: { customerRetentionYears: true } });
  return NextResponse.json({ customerRetentionYears: shop?.customerRetentionYears ?? null, minimumYears: RECORD_KEEPING_YEARS });
}

export async function PUT(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = parseRetentionYears(body?.customerRetentionYears);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const shop = await prisma.shopProfile.findFirst({ select: { id: true, customerRetentionYears: true } });
    if (!shop) return NextResponse.json({ error: "Please save shop profile first" }, { status: 400 });
    const before = shop.customerRetentionYears ?? null;
    if (before !== parsed.value) {
      await prisma.shopProfile.update({ where: { id: shop.id }, data: { customerRetentionYears: parsed.value } });
      const actor = await getCurrentUser();
      if (actor) {
        await writeAuditLog({
          actor,
          request,
          action: "PRIVACY_SETTINGS_UPDATED",
          entityType: "ShopProfile",
          entityId: shop.id,
          summary: parsed.value ? `Customer records kept for ${parsed.value} years` : "Customer retention schedule turned off",
          details: { changedFields: ["customerRetentionYears"], before: { customerRetentionYears: before }, after: { customerRetentionYears: parsed.value } },
        });
      }
    }
    return NextResponse.json({ customerRetentionYears: parsed.value, minimumYears: RECORD_KEEPING_YEARS });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}

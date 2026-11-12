import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { effectiveRate, normaliseScope } from "@/lib/tax";

export const dynamic = "force-dynamic";

/** SST settings for the quote preview (any logged-in user; no secrets). */
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const shop = await prisma.shopProfile.findFirst({ select: { sstNumber: true, sstRate: true, sstScope: true } });
  const rate = effectiveRate(shop);
  return NextResponse.json({ active: rate > 0, rate, scope: normaliseScope(shop?.sstScope) });
}

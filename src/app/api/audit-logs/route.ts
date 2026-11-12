import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const url = new URL(request.url);
  const page = Math.max(1, Math.min(10000, Number(url.searchParams.get("page")) || 1));
  const pageSize = 50;
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.auditLog.count(),
  ]);
  return NextResponse.json({ items, total, page, pageSize }, { headers: { "Cache-Control": "private, no-store" } });
}

import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** 【中文】供应商名单（仅老板），录入发票时用来自动提示供应商名字。 */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  const list = await prisma.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  return NextResponse.json(list);
}

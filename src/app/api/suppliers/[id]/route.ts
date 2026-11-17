import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** 【中文】修改供应商联系资料（电话、地址、备注）。名字不能改，避免和旧发票对不上。 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await params;
    const b = await request.json();
    const s = await prisma.supplier.update({
      where: { id },
      data: { phone: text(b.phone, 50) || null, address: text(b.address, 300) || null, notes: text(b.notes, 500) || null },
    });
    return NextResponse.json(s);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to save supplier" }, { status: 500 });
  }
}

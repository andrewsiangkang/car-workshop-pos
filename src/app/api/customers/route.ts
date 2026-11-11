import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const b = await request.json();
    const name = String(b.name || "").trim();
    const phone = String(b.phone || "").trim();
    if (!name || !phone) {
      return NextResponse.json({ error: "Please fill in name and phone" }, { status: 400 });
    }
    const dup = await prisma.customer.findFirst({ where: { phone } });
    if (dup) return NextResponse.json({ error: "A customer with this phone already exists" }, { status: 409 });
    const c = await prisma.customer.create({
      data: {
        name,
        phone,
        email: String(b.email || "").trim() || null,
        tin: String(b.tin || "").trim() || null,
        notes: String(b.notes || "").trim() || null,
      },
    });
    return NextResponse.json(c, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}

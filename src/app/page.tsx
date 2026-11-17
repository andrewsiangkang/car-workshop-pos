import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    const count = await prisma.user.count();
    if (count === 0) {
      redirect("/setup");
    }
  } catch (e) {
    // Database not ready yet (run npx prisma db push)
    console.error("DB error on home:", e);
    redirect("/setup");
  }

  const userId = await getSessionUserId();
  if (!userId) {
    redirect("/login");
  }
  redirect("/dashboard");
}

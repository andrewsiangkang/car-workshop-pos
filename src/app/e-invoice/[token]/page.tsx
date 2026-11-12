import { prisma } from "@/lib/prisma";
import { requestLockReason } from "@/lib/einvoice-request";
import { BuyerRequestForm } from "@/components/einvoice/BuyerRequestForm";
import { MY_STATES } from "@/lib/my-states";

export const dynamic = "force-dynamic";
export const metadata = { title: "e-Invoice", robots: { index: false, follow: false } };

/** PUBLIC page opened from the QR code on the invoice / receipt. Shows almost nothing about the job. */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const order = /^[A-Za-z0-9_-]{16,64}$/.test(token)
    ? await prisma.workOrder.findUnique({
        where: { eInvoiceToken: token },
        select: {
          invoiceNumber: true, status: true, totalAmount: true, eInvoiceUuid: true, eInvoiceStatus: true,
          consolidatedId: true, buyerRequestedAt: true,
        },
      })
    : null;
  const shop = await prisma.shopProfile.findFirst({ select: { name: true, phone: true } });

  const states = Object.entries(MY_STATES)
    .filter(([code]) => code !== "17")
    .map(([code, name]) => ({ code, name }));

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 py-6" data-no-i18n>
      <BuyerRequestForm
        token={token}
        found={!!order}
        lock={order ? requestLockReason(order) : "no_invoice"}
        alreadySent={!!order?.buyerRequestedAt}
        shopName={shop?.name || "Workshop"}
        shopPhone={shop?.phone || ""}
        invoiceNumber={order?.invoiceNumber || ""}
        total={order?.totalAmount ?? 0}
        states={states}
      />
    </main>
  );
}

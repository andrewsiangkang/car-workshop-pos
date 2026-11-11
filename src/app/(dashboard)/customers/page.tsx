import { Header } from "@/components/layout/Header";
import { Search, Phone, Car } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";
import { AddCustomerButton } from "@/components/customers/AddCustomerButton";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const term = q.trim();
  const customers = await prisma.customer.findMany({
    where: term
      ? {
          OR: [
            { name: { contains: term } },
            { phone: { contains: term } },
            { vehicles: { some: { plateNumber: { contains: term.toUpperCase() } } } },
          ],
        }
      : {},
    orderBy: { createdAt: "desc" },
    include: {
      vehicles: { select: { id: true } },
      workOrders: { select: { paidAmount: true, createdAt: true } },
    },
  });

  return (
    <div>
      <Header title="Customers" description="Manage customer and vehicle information" actions={<AddCustomerButton />} />

      <form method="get" className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} type="text" placeholder="Search name, phone or plate，by Enter..." className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        </div>
      </form>

      {customers.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          {term ? "No matching customers" : "No customers yet。Customers are created automatically when you create a work order，You can also click “Add Customer” in the top right。"}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {customers.map((c) => {
            const spent = c.workOrders.reduce((s, o) => s + o.paidAmount, 0);
            const last = c.workOrders.reduce<Date | null>(
              (m, o) => (!m || o.createdAt > m ? o.createdAt : m),
              null
            );
            return (
              <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{c.name}</h3>
                    <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                      <Phone className="h-3.5 w-3.5" />
                      {c.phone}
                    </div>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 font-semibold text-blue-700">
                    {c.name.charAt(0)}
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-sm">
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <Car className="h-4 w-4" />
                    {c.vehicles.length}  vehicle(s)
                  </div>
                  <div className="text-slate-500">Last：{last ? formatDate(last) : "-"}</div>
                </div>
                <div className="mt-2 text-right text-sm font-medium text-slate-900">Total Spent {formatCurrency(spent)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

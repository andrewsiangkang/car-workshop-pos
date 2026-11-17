import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { isOwner, requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/status";
import { CustomerDetail } from "@/components/customers/CustomerDetail";
import { recordKeepingCheck } from "@/lib/privacy-customer.mjs";
import { reminderLanguage } from "@/lib/privacy-reminders.mjs";
import { ORDER_DATES_SELECT } from "@/lib/privacy-anonymise";

export const dynamic = "force-dynamic";

/**
 * One customer: details, cars and jobs. Staff see the name, phone, cars, jobs and reminder consent;
 * the boss also sees and corrects the e-mail, TIN and address, and can export or anonymise the record.
 * 【中文】客户详情：员工看到名字、电话、车辆、工单和提醒同意记录；老板还能看到并更正电邮、TIN、地址，导出或匿名化资料。
 */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePageUser();
  const owner = isOwner(me);
  const { id } = await params;
  const [customer, shop] = await Promise.all([
    prisma.customer.findUnique({
      where: { id },
      include: {
        vehicles: { orderBy: { updatedAt: "desc" }, select: { id: true, plateNumber: true, make: true, model: true, year: true } },
        workOrders: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            orderNumber: true,
            totalAmount: true,
            vehicle: { select: { plateNumber: true } },
            ...ORDER_DATES_SELECT,
          },
        },
      },
    }),
    prisma.shopProfile.findFirst({ select: { locale: true } }),
  ]);
  if (!customer) notFound();

  const recent = recordKeepingCheck(customer.workOrders, new Date());
  const iso = (d: Date | null) => (d ? d.toISOString() : null);

  return (
    <div>
      <Link href="/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" />
        <span>Customers</span>
      </Link>
      <Header title={customer.name} description="Customer details, cars and jobs" />
      <CustomerDetail
        owner={owner}
        defaultLanguage={reminderLanguage(customer.language, shop?.locale)}
        recentTaxDocuments={recent}
        customer={{
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          // Contact and ID details beyond the phone are boss-only.
          email: owner ? customer.email : null,
          tin: owner ? customer.tin : null,
          address: owner ? customer.address : null,
          postcode: owner ? customer.postcode : null,
          city: owner ? customer.city : null,
          stateCode: owner ? customer.stateCode : null,
          notes: customer.notes,
          language: customer.language,
          reminderConsentAt: iso(customer.reminderConsentAt),
          reminderOptOutAt: iso(customer.reminderOptOutAt),
          anonymisedAt: iso(customer.anonymisedAt),
        }}
      />

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-900">Vehicles</h2>
          {customer.vehicles.length === 0 ? (
            <p className="text-sm text-slate-400">No vehicles</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {customer.vehicles.map((v) => (
                <li key={v.id} className="py-2">
                  <div className="font-semibold text-slate-900">{v.plateNumber}</div>
                  <div className="text-slate-500">
                    {v.make} {v.model} {v.year ?? ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:col-span-2">
          <h2 className="px-5 pt-5 font-semibold text-slate-900">Jobs</h2>
          {customer.workOrders.length === 0 ? (
            <p className="px-5 pb-5 pt-3 text-sm text-slate-400">No jobs yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="mt-3 w-full min-w-[520px] text-left text-sm">
                <thead className="border-y border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-2 font-medium">Job</th>
                    <th className="px-5 py-2 font-medium">Plate</th>
                    <th className="px-5 py-2 font-medium">Date</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                    {owner && <th className="px-5 py-2 text-right font-medium">Amount</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {customer.workOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50">
                      <td className="px-5 py-2.5">
                        <Link href={`/work-orders/${o.id}`} className="font-medium text-blue-700 hover:underline">
                          {o.invoiceNumber || o.orderNumber}
                        </Link>
                      </td>
                      <td className="px-5 py-2.5 text-slate-600">{o.vehicle?.plateNumber}</td>
                      <td className="px-5 py-2.5 text-slate-600">{formatDate(o.createdAt)}</td>
                      <td className="px-5 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[o.status] || ""}`}>{STATUS_LABEL[o.status] || o.status}</span>
                      </td>
                      {owner && <td className="px-5 py-2.5 text-right text-slate-800">{formatCurrency(o.totalAmount)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { Header } from "@/components/layout/Header";
import { Search, Car } from "lucide-react";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const term = q.trim();
  const vehicles = await prisma.vehicle.findMany({
    where: term
      ? {
          OR: [
            { plateNumber: { contains: term.toUpperCase() } },
            { customer: { name: { contains: term } } },
          ],
        }
      : {},
    orderBy: { updatedAt: "desc" },
    include: { customer: true },
  });

  return (
    <div>
      <Header title="Vehicles" description="View all registered vehicles（Registered automatically when creating a work order）" />

      <form method="get" className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} type="text" placeholder="Search plate or owner，by Enter..." className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        </div>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Plate</th>
              <th className="px-5 py-3 font-medium">Model</th>
              <th className="px-5 py-3 font-medium">Year</th>
              <th className="px-5 py-3 font-medium">Owner</th>
              <th className="px-5 py-3 text-right font-medium">Mileage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {vehicles.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400">No vehicles yetdetails</td></tr>
            )}
            {vehicles.map((v) => (
              <tr key={v.id} className="hover:bg-slate-50">
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
                      <Car className="h-4 w-4 text-slate-500" />
                    </div>
                    <span className="font-semibold text-slate-900">{v.plateNumber}</span>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-slate-700">{v.make} {v.model}</td>
                <td className="px-5 py-3.5 text-slate-600">{v.year ?? "-"}</td>
                <td className="px-5 py-3.5 text-slate-600">{v.customer.name}</td>
                <td className="px-5 py-3.5 text-right text-slate-600">
                  {v.mileage != null ? `${v.mileage.toLocaleString()} km` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

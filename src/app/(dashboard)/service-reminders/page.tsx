import { Header } from "@/components/layout/Header";
import { prisma } from "@/lib/prisma";
import { ServiceRemindersClient } from "@/components/service-reminders/ServiceRemindersClient";

export const dynamic = "force-dynamic";

export default async function ServiceRemindersPage() {
  const vehicles = await prisma.vehicle.findMany({
    orderBy: { updatedAt: "desc" },
    include: { customer: { select: { name: true, phone: true } } },
    take: 1000,
  });

  const initialVehicles = vehicles.map((v) => ({
    id: v.id,
    plateNumber: v.plateNumber,
    make: v.make,
    model: v.model,
    mileage: v.mileage,
    lastServiceDate: v.lastServiceDate?.toISOString() ?? null,
    lastServiceMileage: v.lastServiceMileage,
    nextServiceDate: v.nextServiceDate?.toISOString() ?? null,
    nextServiceMileage: v.nextServiceMileage,
    serviceIntervalKm: v.serviceIntervalKm,
    serviceIntervalMonths: v.serviceIntervalMonths,
    customer: v.customer,
  }));

  return (
    <div>
      <Header
        title="Service Reminders"
        description="Track upcoming vehicle maintenance and contact customers before their next service is due."
      />
      <ServiceRemindersClient initialVehicles={initialVehicles} />
    </div>
  );
}

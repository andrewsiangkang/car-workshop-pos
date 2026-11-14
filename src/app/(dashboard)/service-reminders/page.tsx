import { Header } from "@/components/layout/Header";
import { prisma } from "@/lib/prisma";
import { ServiceRemindersClient } from "@/components/service-reminders/ServiceRemindersClient";
import { requirePageUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ServiceRemindersPage() {
  await requirePageUser();
  const [vehicles, shop] = await Promise.all([
    prisma.vehicle.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        customer: {
          select: { id: true, name: true, phone: true, language: true, reminderConsentAt: true, reminderOptOutAt: true, anonymisedAt: true },
        },
      },
      take: 1000,
    }),
    prisma.shopProfile.findFirst({ select: { name: true, locale: true } }),
  ]);

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
    customer: {
      id: v.customer.id,
      name: v.customer.name,
      phone: v.customer.phone,
      language: v.customer.language,
      reminderConsentAt: v.customer.reminderConsentAt?.toISOString() ?? null,
      reminderOptOutAt: v.customer.reminderOptOutAt?.toISOString() ?? null,
      anonymisedAt: v.customer.anonymisedAt?.toISOString() ?? null,
    },
  }));

  return (
    <div>
      <Header
        title="Service Reminders"
        description="Track upcoming vehicle maintenance and contact customers before their next service is due."
      />
      <ServiceRemindersClient initialVehicles={initialVehicles} shopName={shop?.name ?? ""} shopLocale={shop?.locale ?? "en-MY"} />
    </div>
  );
}

import { prisma } from "@/lib/prisma";

/** Idempotently seed generic workshop resources without changing existing shop data. */
export async function ensureWorkshopDefaults() {
  const bays = ["Bay 1", "Bay 2", "Bay 3", "Inspection Bay"];
  for (const name of bays) {
    await prisma.serviceBay.upsert({ where: { name }, update: {}, create: { name, bayType: name === "Inspection Bay" ? "INSPECTION" : "GENERAL" } });
  }
  const templateName = "General Vehicle Inspection";
  const template = await prisma.inspectionTemplate.upsert({
    where: { name: templateName },
    update: {},
    create: { name: templateName, vehicleType: "GENERAL", items: { create: [
      ["Engine", "Engine oil condition"], ["Engine", "Coolant level and condition"], ["Brakes", "Brake pad condition"], ["Brakes", "Brake fluid level"], ["Tyres", "Tyre tread and pressure"], ["Battery", "Battery condition"], ["Transmission", "Transmission fluid / leaks"], ["Suspension", "Suspension and steering"], ["Electrical", "Lights and indicators"], ["Air Conditioning", "Air-conditioning operation"], ["Safety", "Seat belts and horn"], ["Exterior", "Body and glass condition"],
    ].map(([category, label], sortOrder) => ({ category, label, sortOrder, isRequired: false })) } },
  });
  return { templateId: template.id };
}

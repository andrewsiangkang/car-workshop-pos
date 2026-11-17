import { Header } from "@/components/layout/Header";
import { NewSupplierInvoice } from "@/components/suppliers/NewSupplierInvoice";
import { requirePageOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function NewSupplierInvoicePage() {
  await requirePageOwner();
  return (
    <div className="max-w-4xl">
      <Header title="New Supplier Invoice" description="Scan or type the invoice. Items are added to stock and sorted into categories." />
      <NewSupplierInvoice />
    </div>
  );
}

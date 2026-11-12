import { DocumentLayout } from "@/components/documents/DocumentLayout";
import { PrintButton } from "@/components/documents/PrintButton";
import { loadDocData } from "@/lib/docdata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const host = (await headers()).get("host");
  const { data, missing } = await loadDocData(id, "receipt", host);
  if (missing === "order") notFound();

  return (
    <div>
      <div className="no-print mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/work-orders/${id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
            Back to Work Order
          </Link>
          <h1 className="text-lg font-semibold text-slate-900">Receipt Preview</h1>
        </div>
        {data && <PrintButton />}
      </div>
      {data ? (
        <DocumentLayout data={data} />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          No receipt yet. Generate an invoice first, then record payment on the work order page.
        </div>
      )}
    </div>
  );
}

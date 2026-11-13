import { prisma } from "@/lib/prisma";

type LogInput = {
  documentType: "INVOICE" | "CONSOLIDATED" | "CREDIT_NOTE";
  documentNumber: string;
  entityId?: string | null;
  submissionUid?: string | null;
  uuid?: string | null;
  status: string;
  environment: "SANDBOX" | "PRODUCTION";
  detail?: unknown;
};

/** Store submission metadata and a redacted error summary; never persist credentials or buyer PII. */
export async function writeEInvoiceSubmissionLog(input: LogInput) {
  const detail = input.detail && typeof input.detail === "object"
    ? input.detail as Record<string, unknown>
    : {};
  const nestedError = detail.error && typeof detail.error === "object"
    ? detail.error as Record<string, unknown>
    : {};
  const errorCode = String(detail.code || detail.errorCode || nestedError.code || "").slice(0, 100) || null;
  // Do not serialize the complete LHDN response: it may echo document or taxpayer fields.
  const errorMessage = String(detail.message || detail.errorDescription || detail.error_description || nestedError.message || (input.detail ? "Submission rejected; inspect the MyInvois response in the portal." : "")).slice(0, 1000) || null;
  try {
    await prisma.eInvoiceSubmissionLog.create({
      data: {
        documentType: input.documentType,
        documentNumber: input.documentNumber.slice(0, 100),
        entityId: input.entityId || null,
        submissionUid: input.submissionUid || null,
        uuid: input.uuid || null,
        status: input.status.slice(0, 40),
        environment: input.environment,
        errorCode,
        errorMessage,
      },
    });
  } catch (error) {
    console.error("MyInvois submission log write failed", error);
  }
}

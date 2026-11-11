import { prisma } from "./prisma";
import crypto from "crypto";

const PROD_API = "https://api.myinvois.hasil.gov.my";
const SANDBOX_API = "https://preprod-api.myinvois.hasil.gov.my";
const PROD_PORTAL = "https://myinvois.hasil.gov.my";
const SANDBOX_PORTAL = "https://preprod.myinvois.hasil.gov.my";

export async function getMyInvoisConfig() {
  const shop = await prisma.shopProfile.findFirst();
  if (!shop?.myInvoisClientId || !shop.myInvoisClientSecret) {
    throw new Error("MyInvois Client ID / Secret not configured in Settings");
  }
  const base = shop.myInvoisSandbox ? SANDBOX_API : PROD_API;
  const portal = shop.myInvoisSandbox ? SANDBOX_PORTAL : PROD_PORTAL;
  return { shop, base, portal };
}

export async function getAccessToken() {
  const { shop, base } = await getMyInvoisConfig();
  const body = new URLSearchParams({
    client_id: shop.myInvoisClientId!,
    client_secret: shop.myInvoisClientSecret!,
    grant_type: "client_credentials",
    scope: "InvoicingAPI",
  });
  const res = await fetch(`${base}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || "Auth failed");
  }
  return data.access_token as string;
}

/** Build a minimal UBL 2.1 JSON invoice structure for MyInvois */
export function buildInvoiceJson(params: {
  invoiceNumber: string;
  issueDate: string;
  issueTime: string;
  supplier: { name: string; tin: string; brn: string; msic: string; msicDesc: string; phone: string; address: string };
  customer: { name: string; tin?: string | null; phone?: string | null };
  lines: { description: string; quantity: number; unitPrice: number; total: number }[];
  total: number;
}) {
  const lines = params.lines.map((l, i) => ({
    ID: [{ _: String(i + 1) }],
    InvoicedQuantity: [{ _: l.quantity, unitCode: "C62" }],
    LineExtensionAmount: [{ _: l.total, currencyID: "MYR" }],
    Item: [{
      CommodityClassification: [{ ItemClassificationCode: [{ _: "001", listID: "CLASS" }] }],
      Description: [{ _: l.description }],
    }],
    Price: [{ PriceAmount: [{ _: l.unitPrice, currencyID: "MYR" }] }],
    ItemPriceExtension: [{ Amount: [{ _: l.total, currencyID: "MYR" }] }],
  }));

  return {
    _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    Invoice: [{
      ID: [{ _: params.invoiceNumber }],
      IssueDate: [{ _: params.issueDate }],
      IssueTime: [{ _: params.issueTime }],
      InvoiceTypeCode: [{ _: "01", listVersionID: "1.0" }],
      DocumentCurrencyCode: [{ _: "MYR" }],
      AccountingSupplierParty: [{
        Party: [{
          IndustryClassificationCode: [{ _: params.supplier.msic, name: params.supplier.msicDesc }],
          PartyIdentification: [
            { ID: [{ _: params.supplier.tin, schemeID: "TIN" }] },
            { ID: [{ _: params.supplier.brn || "NA", schemeID: "BRN" }] },
          ],
          PartyName: [{ Name: [{ _: params.supplier.name }] }],
          PostalAddress: [{
            AddressLine: [{ Line: [{ _: params.supplier.address || "NA" }] }],
            Country: [{ IdentificationCode: [{ _: "MYS" }] }],
          }],
          PartyLegalEntity: [{ RegistrationName: [{ _: params.supplier.name }] }],
          Contact: [{ Telephone: [{ _: params.supplier.phone || "NA" }] }],
        }],
      }],
      AccountingCustomerParty: [{
        Party: [{
          PartyIdentification: [
            { ID: [{ _: params.customer.tin || "EI00000000010", schemeID: "TIN" }] },
          ],
          PartyName: [{ Name: [{ _: params.customer.name || "General Public" }] }],
          PostalAddress: [{
            AddressLine: [{ Line: [{ _: "NA" }] }],
            Country: [{ IdentificationCode: [{ _: "MYS" }] }],
          }],
          Contact: [{ Telephone: [{ _: params.customer.phone || "NA" }] }],
        }],
      }],
      TaxTotal: [{
        TaxAmount: [{ _: 0, currencyID: "MYR" }],
        TaxSubtotal: [{
          TaxableAmount: [{ _: params.total, currencyID: "MYR" }],
          TaxAmount: [{ _: 0, currencyID: "MYR" }],
          TaxCategory: [{
            ID: [{ _: "06" }],
            TaxScheme: [{ ID: [{ _: "OTH", schemeAgencyID: "6", schemeID: "UN/ECE 5153" }] }],
          }],
        }],
      }],
      LegalMonetaryTotal: [{
        LineExtensionAmount: [{ _: params.total, currencyID: "MYR" }],
        TaxExclusiveAmount: [{ _: params.total, currencyID: "MYR" }],
        TaxInclusiveAmount: [{ _: params.total, currencyID: "MYR" }],
        PayableAmount: [{ _: params.total, currencyID: "MYR" }],
      }],
      InvoiceLine: lines,
    }],
  };
}

export function documentHashAndBase64(jsonObj: unknown) {
  const json = JSON.stringify(jsonObj);
  const hash = crypto.createHash("sha256").update(json).digest("hex");
  const b64 = Buffer.from(json, "utf8").toString("base64");
  return { hash, b64, json };
}

export const GENERAL_PUBLIC_TIN: "EI00000000010";
export const ID_TYPES: readonly ["NRIC", "PASSPORT", "BRN", "ARMY"];

type BuyerIds = { tin?: string | null; idType?: string | null; idNo?: string | null } | null | undefined;

export type BuyerParty =
  | {
      ok: true;
      kind: "general_public" | "individual_no_tin" | "with_tin";
      tin: string;
      idScheme: string;
      idValue: string;
    }
  | { ok: false; field: "tin" | "idNo"; message: string };

export function isMyKadNumber(v: unknown): boolean;
export function isSsmRegistrationNumber(v: unknown, now?: Date): boolean;
export function supplierSecondId(
  tin: string | null | undefined,
  brn: string | null | undefined
): { scheme: "NRIC" | "BRN"; value: string };
export function checkBuyerId(idType: unknown, idNo: unknown): null | "required" | "invalid";
export function maskId(v: unknown): string;
export function buyerParty(b: BuyerIds): BuyerParty;
export function isGeneralPublicBuyer(b: BuyerIds): boolean;

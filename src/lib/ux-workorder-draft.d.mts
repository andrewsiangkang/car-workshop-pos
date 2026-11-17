export type DraftItem = {
  type: "PART" | "LABOR";
  description: string;
  quantity: number;
  unitPrice: number;
  inventoryItemId: string | null;
};

export type DraftForm = {
  plate: string;
  make: string;
  model: string;
  customerName: string;
  phone: string;
  mileage: string;
  description: string;
  diagnosis: string;
  discount: number;
  items: DraftItem[];
};

/** The parts of Storage the draft helpers use (localStorage, or a test double). */
export type DraftStorage = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type DraftInput = {
  plate?: string;
  make?: string;
  model?: string;
  customerName?: string;
  phone?: string;
  mileage?: string;
  description?: string;
  diagnosis?: string;
  discount?: number;
  items?: ReadonlyArray<{
    type?: string;
    description?: string;
    quantity?: number;
    unitPrice?: number;
    inventoryItemId?: string | null;
    costPrice?: number;
  }>;
};

export const DRAFT_VERSION: number;
export const DRAFT_KEY_PREFIX: string;
export const DRAFT_MAX_AGE_MS: number;
export function draftStorageKey(userId: string | null | undefined): string | null;
export function draftFields(form: DraftInput | null | undefined): DraftForm;
export function isDraftWorthKeeping(form: DraftInput | null | undefined): boolean;
export function serializeDraft(form: DraftInput, now: number): string;
export function parseDraft(raw: string | null | undefined, now: number): { savedAt: number; form: DraftForm } | null;
export function saveDraft(storage: DraftStorage | null | undefined, userId: string, form: DraftInput, now: number): boolean;
export function autosaveDraft(
  storage: DraftStorage | null | undefined,
  userId: string,
  form: DraftInput,
  now: number,
  offer: { savedAt: number; form: DraftForm } | null | undefined
): boolean;
export function loadDraft(storage: DraftStorage | null | undefined, userId: string, now: number): { savedAt: number; form: DraftForm } | null;
export function hasDraft(storage: DraftStorage | null | undefined, userId: string, now: number): boolean;
export function clearDraft(storage: DraftStorage | null | undefined, userId: string): void;
export function pruneDrafts(storage: DraftStorage | null | undefined, now: number): number;
export function browserStorage(): DraftStorage | null;

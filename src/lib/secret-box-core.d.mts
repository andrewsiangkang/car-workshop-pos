export const SEAL_PREFIX: "enc:v1:";
export function parseDataKey(value: unknown): Buffer | null;
export function isSealed(stored: unknown): boolean;
export function sealWith(plain: string, key: Buffer): string;
export function revealWith(stored: string | null | undefined, key: Buffer | null | undefined): string | null;

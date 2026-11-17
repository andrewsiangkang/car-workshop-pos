export const INTERNAL_HEADER: "x-workshop-internal";
export const MAX_SKEW_MS: number;
export function makeInternalToken(secret: string, now?: number): string;
export function checkInternalToken(header: unknown, secret: string | null | undefined, now?: number): boolean;
export function isLoopbackAddress(addr: string | null | undefined): boolean;
export function isLoopbackHost(host: string | null | undefined): boolean;

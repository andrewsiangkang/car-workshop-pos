export const SESSION_COOKIE: "session";
export function getAuthSecret(): string;
export function getConfiguredAuthSecret(): string | null;
export function verifySessionSignature(token: string): Promise<boolean>;

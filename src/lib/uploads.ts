import path from "path";

/**
 * Uploaded files live in the writable data folder (WORKSHOP_DATA_DIR in the desktop
 * app), not inside the program folder, which may be read-only and is replaced on update.
 */
export function uploadDir() {
  return path.join(process.env.WORKSHOP_DATA_DIR || path.join(process.cwd(), "data"), "uploads");
}

export const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "image/png": { ext: "png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/webp": { ext: "webp", magic: (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
};

export const EXT_TO_TYPE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/** Only names we generated ourselves are servable (blocks ../ path traversal). */
export const SAFE_NAME = /^[a-z0-9-]+\.(png|jpg|webp)$/;

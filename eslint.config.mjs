import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

// eslint-config-next 15.x still ships the legacy (eslintrc) format, so it is loaded
// through FlatCompat. (The previous flat-config imports only exist in v16 and crashed
// `npm run lint` with ERR_MODULE_NOT_FOUND.)
// 【中文】eslint-config-next 15 仍是旧格式，需要用 FlatCompat 载入；之前的写法只适用于 v16，导致 lint 无法运行。
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Electron main process and build scripts are plain CommonJS: require() is correct there.
    files: ["electron/**/*.js", "scripts/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // public/ocr is copied in from node_modules at build time (scripts/copy-ocr.js).
    ignores: [".next/**", "out/**", "build/**", "dist/**", "public/ocr/**", "next-env.d.ts"],
  },
];

export default eslintConfig;

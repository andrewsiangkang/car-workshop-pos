import fs from "node:fs";
import path from "node:path";

const appServerDir = path.resolve(process.argv[2] || "dist/win-unpacked/resources/app-server");
const required = [
  "server.js",
  path.join("node_modules", "next", "package.json"),
  path.join("node_modules", "@prisma", "client", "package.json"),
  path.join("node_modules", ".prisma", "client", "index.js"),
];
const missing = required.filter((relativePath) => !fs.existsSync(path.join(appServerDir, relativePath)));

if (missing.length) {
  console.error(`Packaged app server is incomplete at ${appServerDir}:`);
  for (const item of missing) console.error(`- ${item}`);
  process.exitCode = 1;
} else {
  console.log(`Packaged app server runtime verified at ${appServerDir}.`);
}

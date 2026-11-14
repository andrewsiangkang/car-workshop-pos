"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_RUNTIME_FILES = [
  ["Next.js", path.join("node_modules", "next", "package.json")],
  ["Prisma client", path.join("node_modules", "@prisma", "client", "package.json")],
  ["generated Prisma client", path.join("node_modules", ".prisma", "client", "index.js")],
];

function missingFiles(baseDir) {
  return REQUIRED_RUNTIME_FILES.filter(([, relativePath]) => !fs.existsSync(path.join(baseDir, relativePath)));
}

module.exports = async function ensureServerRuntime(context) {
  const projectDir = context.packager.projectDir || process.cwd();
  const standaloneDir = path.join(projectDir, ".next", "standalone");
  const targetDir = path.join(context.appOutDir, "resources", "app-server");
  const sourceNodeModules = path.join(standaloneDir, "node_modules");
  const targetNodeModules = path.join(targetDir, "node_modules");

  if (!fs.existsSync(path.join(standaloneDir, "server.js"))) {
    throw new Error(`Cannot package Workshop POS: standalone server is missing at ${standaloneDir}`);
  }
  const missingFromSource = missingFiles(standaloneDir);
  if (missingFromSource.length) {
    throw new Error(`Cannot package Workshop POS: standalone runtime is missing ${missingFromSource.map(([name]) => name).join(", ")}`);
  }
  if (!fs.existsSync(path.join(targetDir, "server.js"))) {
    throw new Error(`Cannot package Workshop POS: staged server is missing at ${targetDir}`);
  }

  const missingFromTarget = missingFiles(targetDir);
  if (missingFromTarget.length) {
    fs.mkdirSync(targetNodeModules, { recursive: true });
    fs.cpSync(sourceNodeModules, targetNodeModules, {
      recursive: true,
      dereference: true,
      force: true,
      filter: (sourcePath) => {
        const name = path.basename(sourcePath);
        return name !== ".env" && !name.startsWith(".env.");
      },
    });
  }

  const stillMissing = missingFiles(targetDir);
  if (stillMissing.length) {
    throw new Error(`Cannot package Workshop POS: staged server is missing ${stillMissing.map(([name]) => name).join(", ")}`);
  }

  console.log("Verified Next.js and generated Prisma runtime in the packaged app server.");
};

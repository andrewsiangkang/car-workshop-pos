// Build a fresh empty SQLite template from the current Prisma schema.
// This template is copied only on first Electron launch; existing user databases are never overwritten.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const template = path.join(root, 'prisma', 'template.db');
fs.mkdirSync(path.dirname(template), { recursive: true });
try { fs.rmSync(template, { force: true }); } catch (error) {
  console.error('Unable to replace SQLite template:', error);
  process.exit(1);
}
const cli = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(cli, ['prisma', 'db', 'push', '--schema', path.join(root, 'prisma', 'schema.prisma'), '--skip-generate'], {
  cwd: root,
  env: { ...process.env, DATABASE_URL: `file:${template.replace(/\\/g, '/')}` },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.error || result.status !== 0 || !fs.existsSync(template) || fs.statSync(template).size === 0) {
  console.error('Failed to generate prisma/template.db.');
  process.exit(1);
}
console.log(`SQLite template generated: ${path.relative(root, template)}`);

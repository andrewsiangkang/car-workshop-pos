// Build an isolated, populated demo database for local Windows demo packaging.
// The normal production template remains empty; demo data is never added to it.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const template = path.join(root, 'prisma', 'template.db');
const loginFile = path.join(root, 'demo-login.txt');
const env = { ...process.env, DATABASE_URL: `file:${template.replace(/\\/g, '/')}`, DEMO_LOGIN_FILE: loginFile };
function run(args, label) {
  const r = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    console.error(`${label} failed; demo package was not prepared.`);
    process.exit(r.status || 1);
  }
}
// Always recreate a clean template: never seed into a previous build's demo DB.
run([path.join(root, 'scripts', 'create-template-db.js')], 'Empty template creation');
run([path.join(root, 'scripts', 'seed-demo.js')], 'Demo data seeding');
if (!fs.existsSync(template) || fs.statSync(template).size === 0 || !fs.existsSync(loginFile)) {
  console.error('Demo template or login file is missing.');
  process.exit(1);
}
console.log('Demo template and one-build login note are ready.');

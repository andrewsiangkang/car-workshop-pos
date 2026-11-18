import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const builder = fs.readFileSync(path.join(root, 'electron-builder-demo.yml'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const seed = require('../scripts/seed-demo.js');
test('demo release version is synchronized', () => {
  assert.equal(pkg.version, '0.5.13');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
});
test('demo package remains isolated from production identity and user data', () => {
  assert.match(builder, /com\.workshop\.pos\.demo/);
  assert.match(builder, /workshopDemo: true/);
  assert.match(main, /IS_DEMO/);
  assert.match(main, /演示版/);
});
test('demo seed creates non-fixed passwords and protects supplied secrets', () => {
  const passwords = seed.demoPasswords({}, (n) => Buffer.alloc(n, 7));
  assert.equal(passwords.generated, true);
  assert.ok(passwords.owner.length >= 8);
  assert.ok(passwords.staff.length >= 8);
  assert.throws(() => seed.demoPasswords({ DEMO_OWNER_PASSWORD: 'short' }), /at least 8/);
  const fromSecret = seed.demoPasswords({ DEMO_OWNER_PASSWORD: 'secret-owner-123', DEMO_STAFF_PASSWORD: 'secret-staff-123' });
  const note = seed.loginText(fromSecret);
  assert.ok(!note.includes('secret-owner-123'));
  assert.ok(!note.includes('secret-staff-123'));
});
test('local demo build regenerates a populated demo template before packaging', () => {
  assert.equal(pkg.scripts['db:template:demo'], 'node scripts/create-demo-template.js');
  assert.match(pkg.scripts['preelectron:dist:demo'], /npm run db:template:demo/);
  const script = fs.readFileSync(path.join(root, 'scripts', 'create-demo-template.js'), 'utf8');
  assert.match(script, /create-template-db\.js/);
  assert.match(script, /seed-demo\.js/);
  assert.match(script, /demo-login\.txt/);
});

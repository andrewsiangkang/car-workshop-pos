import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_GENESIS,
  auditEntryHash,
  canonicalAuditEntry,
  nextChainLink,
  verifyAuditChain,
  createAuditChainVerifier,
  auditFieldChanges,
  flattenSettings,
  auditAddress,
  maskTail,
  createWindowLimiter,
  clipText,
} from "../src/lib/privacy-audit.mjs";

/** Builds a chain the way src/lib/audit.ts writes it. */
function buildChain(n) {
  const rows = [];
  let last = null;
  for (let i = 0; i < n; i++) {
    const base = {
      id: `id${i}`,
      actorUserId: i % 2 ? "u1" : null,
      actorName: i % 2 ? "Ah Boss" : "Not signed in",
      actorRole: i % 2 ? "OWNER" : "-",
      action: i % 2 ? "SHOP_SETTINGS_UPDATED" : "LOGIN_FAILED",
      entityType: "ShopProfile",
      entityId: i % 2 ? "shop1" : null,
      summary: `entry ${i}`,
      details: JSON.stringify({ n: i }),
      ipAddress: "192.168.1.20",
      createdAt: new Date(Date.UTC(2026, 10, 14, 10, 0, i, 123)),
    };
    const link = nextChainLink(last);
    const row = { ...base, ...link };
    row.hash = auditEntryHash(row);
    rows.push(row);
    last = { seq: row.seq, hash: row.hash };
  }
  return rows;
}

test("the chain starts at seq 1 with prevHash GENESIS and each entry points at the previous hash", () => {
  const rows = buildChain(4);
  assert.equal(rows[0].seq, 1);
  assert.equal(rows[0].prevHash, AUDIT_GENESIS);
  for (let i = 1; i < rows.length; i++) {
    assert.equal(rows[i].seq, rows[i - 1].seq + 1);
    assert.equal(rows[i].prevHash, rows[i - 1].hash);
  }
  assert.match(rows[0].hash, /^[0-9a-f]{64}$/);
});

test("an untouched chain verifies as intact", () => {
  const r = verifyAuditChain(buildChain(25));
  assert.equal(r.ok, true);
  assert.equal(r.checked, 25);
  assert.equal(r.last.seq, 25);
  assert.equal(r.problem, null);
});

test("the hash covers the time to the millisecond, as read back from the database", () => {
  const [row] = buildChain(1);
  // Prisma returns a Date; an ISO string of the same moment gives the same hash.
  assert.equal(auditEntryHash({ ...row, createdAt: row.createdAt.toISOString() }), row.hash);
  assert.notEqual(auditEntryHash({ ...row, createdAt: new Date(row.createdAt.getTime() + 1) }), row.hash);
  assert.ok(canonicalAuditEntry(row).includes("2026-11-14T10:00:00.123Z"));
});

test("edited details are reported as an altered entry", () => {
  const rows = buildChain(6);
  rows[3] = { ...rows[3], details: JSON.stringify({ n: 999 }) };
  const r = verifyAuditChain(rows);
  assert.equal(r.ok, false);
  assert.equal(r.problem.kind, "altered");
  assert.equal(r.problem.seq, 4);
  assert.equal(r.checked, 3);
});

test("every stored field counts: actor, action, summary, address", () => {
  for (const field of ["actorName", "actorRole", "action", "summary", "ipAddress", "entityId"]) {
    const rows = buildChain(3);
    rows[1] = { ...rows[1], [field]: "changed" };
    assert.equal(verifyAuditChain(rows).problem?.kind, "altered", field);
  }
});

test("a deleted entry is reported as missing", () => {
  const rows = buildChain(6);
  rows.splice(2, 1); // seq 3 removed
  const r = verifyAuditChain(rows);
  assert.equal(r.ok, false);
  assert.equal(r.problem.kind, "missing");
  assert.equal(r.problem.seq, 4);
  assert.equal(r.problem.expectedSeq, 3);
});

test("deleting the first entries is reported too", () => {
  const rows = buildChain(4).slice(1);
  assert.equal(verifyAuditChain(rows).problem?.kind, "missing");
});

test("reordered entries (seq numbers swapped) no longer match their hashes", () => {
  const rows = buildChain(5);
  const a = rows[1];
  const b = rows[2];
  // Swap their places in the sequence: each now carries the other's seq.
  const swapped = [rows[0], { ...b, seq: a.seq }, { ...a, seq: b.seq }, rows[3], rows[4]];
  const r = verifyAuditChain(swapped);
  assert.equal(r.ok, false);
  assert.equal(r.problem.kind, "altered");
  assert.equal(r.problem.seq, 2);
});

test("an entry rewritten with a fresh hash still breaks the link to the next entry", () => {
  const rows = buildChain(5);
  const forged = { ...rows[2], summary: "nothing to see" };
  forged.hash = auditEntryHash(forged);
  rows[2] = forged;
  const r = verifyAuditChain(rows);
  assert.equal(r.problem.kind, "broken-link");
  assert.equal(r.problem.seq, 4);
});

test("an entry inserted with a repeated seq is reported as a duplicate", () => {
  const rows = buildChain(4);
  rows.splice(2, 0, { ...rows[1] });
  assert.equal(verifyAuditChain(rows).problem?.kind, "duplicate");
});

test("the verifier can be fed in batches and stops at the first problem", () => {
  const rows = buildChain(10);
  rows[7] = { ...rows[7], details: "{}" };
  const v = createAuditChainVerifier();
  for (const r of rows.slice(0, 5)) assert.equal(v.push(r), null);
  let problem = null;
  for (const r of rows.slice(5)) problem = v.push(r) || problem;
  assert.equal(problem.seq, 8);
  assert.equal(v.result().checked, 7);
});

test("settings before / after: secrets only as changed, bank account masked, unchanged fields left out", () => {
  const before = { name: "Ah Seng Motor", sstRate: 6, myInvoisClientSecret: "enc:v1:aaa", bankAccount: "1234567890", phone: "", documentSettings: "{}" };
  const after = { name: "Ah Seng Motor Sdn Bhd", sstRate: 6, myInvoisClientSecret: "enc:v1:bbb", bankAccount: "9876543210", phone: null, documentSettings: '{"a":1}' };
  const d = auditFieldChanges(before, after, { hidden: ["myInvoisClientSecret"], masked: ["bankAccount"], opaque: ["documentSettings"] });
  assert.deepEqual(d.changedFields.sort(), ["bankAccount", "documentSettings", "myInvoisClientSecret", "name"]);
  assert.equal(d.before.name, "Ah Seng Motor");
  assert.equal(d.after.name, "Ah Seng Motor Sdn Bhd");
  assert.equal(d.after.myInvoisClientSecret, "(changed)");
  assert.ok(!JSON.stringify(d).includes("enc:v1:"), "the stored secret never appears");
  assert.equal(d.before.bankAccount, "••••7890");
  assert.equal(d.after.bankAccount, "••••3210");
  assert.equal(d.after.documentSettings, "(changed)");
  assert.equal(maskTail(""), null);
});

test("nested template settings are compared field by field", () => {
  const before = flattenSettings({ invoice: { footer: "Thanks", showSignature: true }, showTaxIds: true });
  const after = flattenSettings({ invoice: { footer: "Thank you", showSignature: true }, showTaxIds: false });
  const d = auditFieldChanges(before, after);
  assert.deepEqual(d.changedFields, ["invoice.footer", "showTaxIds"]);
  assert.equal(d.before["invoice.footer"], "Thanks");
  assert.equal(d.after.showTaxIds, false);
});

test("address: the socket address is stored; a client-typed X-Forwarded-For is only 'reported'", () => {
  assert.deepEqual(auditAddress({ peer: "192.168.1.30", forwardedFor: "192.168.1.30" }), { ipAddress: "192.168.1.30", reported: null });
  assert.deepEqual(auditAddress({ peer: "::ffff:192.168.1.30", forwardedFor: "1.2.3.4" }), { ipAddress: "192.168.1.30", reported: "1.2.3.4" });
  // Desktop app over IPv4-mapped loopback: Next.js copies the socket address, nothing reported.
  assert.deepEqual(auditAddress({ peer: "::ffff:127.0.0.1", forwardedFor: "::ffff:127.0.0.1" }), { ipAddress: "127.0.0.1", reported: null });
  // Socket address unknown: nothing trusted, the header is kept as reported only.
  assert.deepEqual(auditAddress({ peer: null, forwardedFor: "10.0.0.5", realIp: null }), { ipAddress: null, reported: "10.0.0.5" });
});

test("flood limiter: at most N per window, the next window learns how many were skipped", () => {
  const l = createWindowLimiter(2, 1000);
  assert.deepEqual(l.take(0), { ok: true, droppedBefore: 0 });
  assert.equal(l.take(10).ok, true);
  assert.equal(l.take(20).ok, false);
  assert.equal(l.take(30).ok, false);
  assert.deepEqual(l.take(1500), { ok: true, droppedBefore: 2 });
});

// Half an emoji (a lone UTF-16 surrogate) makes Prisma refuse the whole audit write, and the event
// would be lost. 【中文】半个表情符号会让数据库拒绝写入，审计记录就丢了。
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test("text is cut by whole characters: an emoji at the limit is kept whole or left out, never halved", () => {
  const name = "a".repeat(99) + "😀" + "tail";
  assert.equal("a".repeat(99) + "😀", name.slice(0, 101));
  assert.ok(LONE.test(name.slice(0, 100)), "a plain slice would split the emoji");
  const cut = clipText(name, 100);
  assert.equal(cut, "a".repeat(99) + "😀");
  assert.equal(LONE.test(cut), false);
  assert.equal(clipText("short", 100), "short");
  assert.equal(clipText(null, 10), "");
  // A half character already in the input becomes U+FFFD.
  assert.equal(clipText("x\uD83Dy", 10), "x\uFFFDy");
  assert.equal(clipText("\uDE00", 10), "\uFFFD");
});

test("an audit entry built from clipped text never holds a lone surrogate, and still hashes the same way", () => {
  const username = "b".repeat(99) + "😀😀";
  const summary = clipText(`Failed login for "${clipText(username, 100)}"`, 240);
  const entry = {
    seq: 1, prevHash: AUDIT_GENESIS, createdAt: new Date("2026-11-14T04:00:00.123Z"),
    actorUserId: null, actorName: clipText("Not signed in", 120), actorRole: "-",
    action: "LOGIN_FAILED", entityType: "User", entityId: null, summary,
    details: JSON.stringify({ username: clipText(username, 100) }), ipAddress: "192.168.1.9",
  };
  for (const k of ["actorName", "summary", "details"]) assert.equal(LONE.test(entry[k]), false, k);
  assert.equal(LONE.test(canonicalAuditEntry(entry)), false);
  assert.equal(verifyAuditChain([{ id: "a", ...entry, hash: auditEntryHash(entry) }]).ok, true);
  // Before / after values and masked tails are cut the same way.
  const diff = auditFieldChanges({ name: "x" }, { name: "y".repeat(119) + "😀😀" });
  assert.equal(diff.after.name, "y".repeat(119) + "😀…");
  assert.equal(LONE.test(maskTail("12😀")), false);
  assert.equal(maskTail("0123456789"), "••••6789");
});

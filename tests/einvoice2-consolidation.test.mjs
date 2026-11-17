// Step 14, e-Invoice lane, fix round: one sale is never reported twice (an invoice whose own
// submission is in flight or unanswered vs the monthly consolidated e-Invoice), the waiting buyer
// requests list keeps showing new customers, and the buyer stays locked while LHDN may hold it.
import test from "node:test";
import assert from "node:assert/strict";
import { BUYER_REQUEST_ALERT_DAYS, buyerRequestWaiting, consolidationEntry, waitingRequestWhere } from "../src/lib/einvoice-rules.mjs";
import { CLAIM_STALE_MS, UNCONFIRMED, claimData, claimWhere, inFlightFor, notInFlightWhere } from "../src/lib/einvoice2-submit.mjs";
import { isReportedFor } from "../src/lib/einvoice-state.mjs";
import { buyerEditLock } from "../src/lib/doc-snapshot.mjs";

const now = new Date("2026-11-14T06:00:00Z");
const ago = (ms) => new Date(now.getTime() - ms);
const DAY = 24 * 3600_000;

/**
 * A small evaluator of the Prisma `where` objects used here, with SQL's NULL rules
 * (NULL never matches `in`, `notIn` or `not: value`).
 */
function matches(row, where) {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return cond.some((w) => matches(row, w));
    if (k === "AND") return cond.every((w) => matches(row, w));
    const v = row[k] ?? null;
    if (cond === null) return v === null;
    if (cond instanceof Date || typeof cond !== "object") return v === cond;
    return Object.entries(cond).every(([op, x]) => {
      if (op === "not") return x === null ? v !== null : v !== null && v !== x;
      if (v === null) return false;
      if (op === "lt") return v < x;
      if (op === "in") return x.includes(v);
      if (op === "notIn") return !x.includes(v);
      throw new Error(`operator ${op} not supported by the test evaluator`);
    });
  });
}

// ---------------------------------------------------------------------------
// An invoice whose own e-Invoice is in flight / unanswered is not consolidated
// ---------------------------------------------------------------------------

const qrOrder = { buyerRequestedAt: ago(20 * DAY), customer: { tin: null }, creditNotes: [] };

test("review scenario: an unanswered individual submission keeps the invoice out of the consolidated e-Invoice", () => {
  // Submitted on its own, LHDN timed out: UUID cleared, marked unconfirmed (it may have arrived).
  const o = { ...qrOrder, eInvoiceUuid: null, eInvoiceStatus: UNCONFIRMED, eInvoiceEnv: "sandbox", eInvoiceSubmittingAt: ago(DAY) };
  assert.equal(isReportedFor(o, "sandbox"), false); // why it used to get a line
  const e = consolidationEntry(o, "sandbox", true, now);
  assert.equal(e.line, false);
  assert.deepEqual(e.blocked, { creditNote: null });
  assert.equal(e.individual, "buyer_request");
});

test("a submission still running (another device) also holds the invoice back", () => {
  const o = { ...qrOrder, eInvoiceUuid: null, eInvoiceStatus: null, eInvoiceSubmittingAt: ago(10_000) };
  assert.deepEqual(consolidationEntry(o, "sandbox", true, now).blocked, { creditNote: null });
  // A claim left behind by a crash may also have reached LHDN.
  const crashed = { ...o, eInvoiceSubmittingAt: ago(CLAIM_STALE_MS + 1) };
  assert.equal(consolidationEntry(crashed, "sandbox", true, now).line, false);
});

test("an invoice with nothing in flight is consolidated as before", () => {
  const o = { ...qrOrder, eInvoiceUuid: null, eInvoiceStatus: null, eInvoiceSubmittingAt: null };
  assert.deepEqual(consolidationEntry(o, "sandbox", true, now), { line: true, individual: "buyer_request", blocked: null });
  // Month still open: a QR buyer is left out (to be e-Invoiced on its own), never "blocked".
  assert.deepEqual(consolidationEntry({ ...o, eInvoiceSubmittingAt: ago(5_000) }, "sandbox", false, now), {
    line: false, individual: "buyer_request", blocked: null,
  });
  // Already e-Invoiced on its own: no line.
  const live = { ...o, eInvoiceUuid: "U1", eInvoiceStatus: "valid", eInvoiceEnv: "production" };
  assert.deepEqual(consolidationEntry(live, "production", true, now), { line: false, individual: null, blocked: null });
});

test("a credit note in flight holds its invoice back too (it would be netted twice)", () => {
  const o = {
    buyerRequestedAt: null, customer: null, eInvoiceUuid: null, eInvoiceStatus: null, eInvoiceSubmittingAt: null,
    creditNotes: [
      { number: "CN20261101001", eInvoiceStatus: null, eInvoiceSubmittingAt: null },
      { number: "CN20261101002", eInvoiceStatus: UNCONFIRMED, eInvoiceEnv: "sandbox", eInvoiceSubmittingAt: ago(DAY) },
    ],
  };
  assert.deepEqual(consolidationEntry(o, "sandbox", true, now).blocked, { creditNote: "CN20261101002" });
});

test("an unanswered SANDBOX test does not hold up a real (production) consolidated e-Invoice", () => {
  const o = { ...qrOrder, eInvoiceUuid: null, eInvoiceStatus: UNCONFIRMED, eInvoiceEnv: "sandbox", eInvoiceSubmittingAt: ago(DAY) };
  assert.equal(inFlightFor(o, "production", now), false);
  assert.equal(consolidationEntry(o, "production", true, now).line, true);
  // A real (production) one that got no answer holds up both.
  const real = { ...o, eInvoiceEnv: "production" };
  assert.equal(inFlightFor(real, "production", now), true);
  assert.equal(inFlightFor(real, "sandbox", now), true);
});

test("the database reservation uses the same rule as the preview (inFlightFor = not notInFlightWhere)", () => {
  const rows = [
    { eInvoiceStatus: null, eInvoiceEnv: null, eInvoiceSubmittingAt: null },
    { eInvoiceStatus: "invalid", eInvoiceEnv: "production", eInvoiceSubmittingAt: null },
    { eInvoiceStatus: null, eInvoiceEnv: null, eInvoiceSubmittingAt: ago(10_000) },
    { eInvoiceStatus: "invalid", eInvoiceEnv: "sandbox", eInvoiceSubmittingAt: ago(CLAIM_STALE_MS + 1) },
    { eInvoiceStatus: UNCONFIRMED, eInvoiceEnv: "sandbox", eInvoiceSubmittingAt: ago(DAY) },
    { eInvoiceStatus: UNCONFIRMED, eInvoiceEnv: "production", eInvoiceSubmittingAt: ago(DAY) },
    // Claims that kept their system (claimData): left behind by a crash, or still running.
    { eInvoiceUuid: null, eInvoiceStatus: null, eInvoiceEnv: "sandbox", eInvoiceSubmittingAt: ago(DAY) },
    { eInvoiceUuid: null, eInvoiceStatus: null, eInvoiceEnv: "sandbox", eInvoiceSubmittingAt: ago(10_000) },
    { eInvoiceUuid: null, eInvoiceStatus: null, eInvoiceEnv: "production", eInvoiceSubmittingAt: ago(DAY) },
    // A claim on a record with an earlier, ended UUID: its system is not known, so it always holds.
    { eInvoiceUuid: "OLD", eInvoiceStatus: "invalid", eInvoiceEnv: "sandbox", eInvoiceSubmittingAt: ago(DAY) },
  ];
  for (const env of ["sandbox", "production"]) {
    for (const r of rows) {
      assert.equal(matches(r, notInFlightWhere(env, now)), !inFlightFor(r, env, now), `${env} ${JSON.stringify(r)}`);
    }
  }
});

test("a SANDBOX claim left behind by a crash does not hold up real work once Settings are on production", () => {
  // The claim keeps the attempt's system on a record with no UUID; an earlier UUID's system never changes.
  assert.deepEqual(claimData({ eInvoiceUuid: null }, now, "sandbox"), { eInvoiceSubmittingAt: now, eInvoiceEnv: "sandbox" });
  assert.deepEqual(claimData({ eInvoiceUuid: "OLD" }, now, "sandbox"), { eInvoiceSubmittingAt: now });
  // ...and the claim's where pins that UUID, so the system is only written while there is none.
  assert.equal(claimWhere({ id: "o1", eInvoiceUuid: null }, now).eInvoiceUuid, null);

  // buyerEditLock reads the real clock, so these claim times are relative to it.
  const t = new Date();
  const order = { eInvoiceUuid: null, eInvoiceStatus: null, consolidatedId: null };
  const leftover = { ...order, eInvoiceEnv: "sandbox", eInvoiceSubmittingAt: new Date(t.getTime() - CLAIM_STALE_MS - 60_000) };
  assert.equal(inFlightFor(leftover, "production", t), false);
  assert.equal(inFlightFor(leftover, "sandbox", t), true);
  assert.equal(buyerEditLock(leftover, null, "production"), null);
  assert.equal(buyerEditLock(leftover, null, "sandbox"), "submitted");
  // A sandbox submission still running (under 2 minutes) may yet write its result: it holds.
  const running = { ...leftover, eInvoiceSubmittingAt: new Date(t.getTime() - 10_000) };
  assert.equal(inFlightFor(running, "production", t), true);
  // A production claim, or one whose system is unknown (an older claim), always holds.
  assert.equal(inFlightFor({ ...leftover, eInvoiceEnv: "production" }, "production", t), true);
  assert.equal(inFlightFor({ ...leftover, eInvoiceEnv: null }, "production", t), true);
  assert.equal(inFlightFor({ ...leftover, eInvoiceUuid: "OLD", eInvoiceStatus: "invalid" }, "production", t), true);
});

// ---------------------------------------------------------------------------
// Waiting buyer requests (H4): done requests are filtered by the database
// ---------------------------------------------------------------------------

test("600 old requests that are all done never hide a customer who is still waiting", () => {
  const cutoff = new Date(now.getTime() - BUYER_REQUEST_ALERT_DAYS * DAY);
  const base = { invoiceNumber: "INV", status: "COMPLETED", consolidatedId: null, eInvoiceUuid: null, eInvoiceStatus: null, eInvoiceEnv: null };
  const rows = [];
  for (let i = 0; i < 600; i++) {
    // Older than the waiting one, all already e-Invoiced (real, still valid).
    rows.push({ ...base, id: `done${i}`, invoiceNumber: `INV${i}`, buyerRequestedAt: ago(400 * DAY - i * 1000), eInvoiceUuid: `U${i}`, eInvoiceStatus: "valid", eInvoiceEnv: "production" });
  }
  // Consolidated in a real monthly e-Invoice (deadline passed): done too.
  rows.push({ ...base, id: "inCon", buyerRequestedAt: ago(300 * DAY), consolidatedId: "conLive" });
  // Linked to a consolidated e-Invoice LHDN rejected: still waiting.
  rows.push({ ...base, id: "inRejectedCon", buyerRequestedAt: ago(200 * DAY), consolidatedId: "conRejected" });
  // A sandbox test only: still waiting for the real one.
  rows.push({ ...base, id: "sandboxOnly", buyerRequestedAt: ago(100 * DAY), eInvoiceUuid: "S1", eInvoiceStatus: "valid", eInvoiceEnv: "sandbox" });
  // LHDN found it invalid: still waiting.
  rows.push({ ...base, id: "invalid", buyerRequestedAt: ago(50 * DAY), eInvoiceUuid: "X1", eInvoiceStatus: "invalid", eInvoiceEnv: "production" });
  // The new customer who is waiting.
  rows.push({ ...base, id: "waiting", buyerRequestedAt: ago(5 * DAY) });
  // Asked yesterday: not yet flagged. Cancelled or no invoice: never.
  rows.push({ ...base, id: "fresh", buyerRequestedAt: ago(DAY) });
  rows.push({ ...base, id: "cancelled", status: "CANCELLED", buyerRequestedAt: ago(10 * DAY) });
  rows.push({ ...base, id: "noInvoice", invoiceNumber: null, buyerRequestedAt: ago(10 * DAY) });

  const where = waitingRequestWhere({ cutoff, env: "production", reportedConsolidatedIds: ["conLive"] });
  // Like the database: filter, oldest first, the first 500.
  const loaded = rows
    .filter((r) => matches(r, where))
    .sort((a, b) => a.buyerRequestedAt - b.buyerRequestedAt)
    .slice(0, 500);
  assert.deepEqual(loaded.map((r) => r.id), ["inRejectedCon", "sandboxOnly", "invalid", "waiting"]);
  // The final check agrees for each of them.
  for (const r of loaded) {
    const ok = buyerRequestWaiting({ ...r, reported: isReportedFor(r, "production"), consolidated: r.consolidatedId === "conLive" }, now);
    assert.equal(ok, true, r.id);
  }
});

test("waiting requests while testing in the sandbox: a sandbox e-Invoice counts as done", () => {
  const cutoff = new Date(now.getTime() - BUYER_REQUEST_ALERT_DAYS * DAY);
  const where = waitingRequestWhere({ cutoff, env: "sandbox", reportedConsolidatedIds: [] });
  const row = { invoiceNumber: "INV1", status: "COMPLETED", consolidatedId: null, buyerRequestedAt: ago(5 * DAY) };
  assert.equal(matches({ ...row, eInvoiceUuid: "S1", eInvoiceStatus: "valid", eInvoiceEnv: "sandbox" }, where), false);
  assert.equal(matches({ ...row, eInvoiceUuid: null, eInvoiceStatus: null, eInvoiceEnv: null }, where), true);
  // No consolidated e-Invoice counts: linked ones are not filtered out.
  assert.equal(matches({ ...row, consolidatedId: "c1", eInvoiceUuid: null }, where), true);
});

// ---------------------------------------------------------------------------
// The buyer cannot be changed while LHDN may hold a document with it
// ---------------------------------------------------------------------------

test("buyer locked while the invoice is being sent or LHDN did not answer", () => {
  const order = { eInvoiceUuid: null, eInvoiceStatus: null, eInvoiceEnv: null, consolidatedId: null };
  assert.equal(buyerEditLock({ ...order, eInvoiceSubmittingAt: new Date(Date.now() - 10_000) }, null), "submitted");
  assert.equal(buyerEditLock({ ...order, eInvoiceStatus: UNCONFIRMED, eInvoiceEnv: "sandbox", eInvoiceSubmittingAt: ago(DAY) }, null), "submitted");
  // Nothing in flight, or a sandbox test result: still editable.
  assert.equal(buyerEditLock({ ...order, eInvoiceSubmittingAt: null }, null), null);
  assert.equal(buyerEditLock({ ...order, eInvoiceUuid: "S1", eInvoiceStatus: "valid", eInvoiceEnv: "sandbox" }, null), null);
  // A claim left behind by a crash: LHDN may hold the document with the current buyer, so the
  // buyer stays locked until Check Status settles it (it used to unlock after 2 minutes).
  const crashed = { ...order, eInvoiceSubmittingAt: new Date(Date.now() - CLAIM_STALE_MS - 60_000) };
  assert.equal(buyerEditLock(crashed, null), "submitted");
  assert.equal(buyerEditLock(crashed, null, "production"), "submitted");
  assert.equal(buyerEditLock(crashed, null, "sandbox"), "submitted");
  // Working in production, an unanswered SANDBOX test does not lock the real buyer (same rule as
  // the consolidation, inFlightFor); in the sandbox, or with no environment given, it does.
  const sandboxTest = { ...order, eInvoiceStatus: UNCONFIRMED, eInvoiceEnv: "sandbox", eInvoiceSubmittingAt: ago(DAY) };
  assert.equal(buyerEditLock(sandboxTest, null, "production"), null);
  assert.equal(buyerEditLock(sandboxTest, null, "sandbox"), "submitted");
  assert.equal(buyerEditLock({ ...sandboxTest, eInvoiceEnv: "production" }, null, "production"), "submitted");
});

// Review Medium (myinvois.ts:434): submission was not idempotent and had no timeout. A double
// click, a second device or a retry after a hang could create duplicate valid e-Invoices.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CLAIM_STALE_MS,
  LOOKUP_AFTER_MS,
  LOOKUP_BEFORE_MS,
  UNCONFIRMED,
  UNCONFIRMED_WAIT_MS,
  claimWhere,
  isUnconfirmed,
  pickSentDocument,
  sentLookupWindow,
  submitGate,
  submitOutcome,
  unconfirmedNext,
  unconfirmedUntil,
} from "../src/lib/einvoice2-submit.mjs";
import { isLiveStatus } from "../src/lib/einvoice-state.mjs";

const now = new Date("2026-11-14T06:00:00Z");
const ago = (ms) => new Date(now.getTime() - ms);

test("gate: nothing in flight → go", () => {
  assert.deepEqual(submitGate({ eInvoiceStatus: null, eInvoiceSubmittingAt: null }, now), { action: "go" });
  assert.deepEqual(submitGate({ eInvoiceStatus: "invalid", eInvoiceSubmittingAt: null }, now), { action: "go" });
});

test("gate: a second click while the first submission runs is refused (wait)", () => {
  const g = submitGate({ eInvoiceStatus: null, eInvoiceSubmittingAt: ago(10_000) }, now);
  assert.equal(g.action, "wait");
  assert.equal(g.until.getTime(), ago(10_000).getTime() + CLAIM_STALE_MS);
});

test("gate: a claim left behind by a crash, or an unanswered submission, asks LHDN first", () => {
  assert.equal(submitGate({ eInvoiceStatus: null, eInvoiceSubmittingAt: ago(CLAIM_STALE_MS + 1) }, now).action, "lookup");
  // Unanswered: even a few seconds later it is never sent blindly again.
  const g = submitGate({ eInvoiceStatus: UNCONFIRMED, eInvoiceSubmittingAt: ago(5_000) }, now);
  assert.equal(g.action, "lookup");
  assert.equal(g.since.getTime(), ago(5_000).getTime());
  assert.equal(isUnconfirmed({ eInvoiceStatus: "Unconfirmed" }), true);
  assert.equal(isUnconfirmed({ eInvoiceStatus: "pending" }), false);
});

test("claim: atomic where — unchanged since read, and no claim younger than 2 minutes", () => {
  const w = claimWhere({ id: "o1", eInvoiceUuid: "OLD", eInvoiceStatus: "invalid" }, now);
  assert.deepEqual(w, {
    id: "o1",
    eInvoiceUuid: "OLD",
    eInvoiceStatus: "invalid",
    OR: [{ eInvoiceSubmittingAt: null }, { eInvoiceSubmittingAt: { lt: ago(CLAIM_STALE_MS) } }],
  });
  // Missing fields mean "IS NULL", never "any value".
  const fresh = claimWhere({ id: "o2" }, now);
  assert.equal(fresh.eInvoiceUuid, null);
  assert.equal(fresh.eInvoiceStatus, null);
});

test("claim: only one of two simultaneous submissions wins (simulated updateMany)", () => {
  const row = { id: "o1", eInvoiceUuid: null, eInvoiceStatus: null, eInvoiceSubmittingAt: null };
  // Minimal evaluator of the where object, like the database would run it.
  const matches = (r, w) =>
    r.id === w.id && r.eInvoiceUuid === w.eInvoiceUuid && r.eInvoiceStatus === w.eInvoiceStatus &&
    w.OR.some((c) => (c.eInvoiceSubmittingAt === null ? r.eInvoiceSubmittingAt === null : r.eInvoiceSubmittingAt && r.eInvoiceSubmittingAt < c.eInvoiceSubmittingAt.lt));
  const updateMany = (w, at) => (matches(row, w) ? ((row.eInvoiceSubmittingAt = at), 1) : 0);
  // Both requests read the row before either claims it.
  const a = claimWhere({ ...row }, now);
  const b = claimWhere({ ...row }, now);
  assert.equal(updateMany(a, now), 1);
  assert.equal(updateMany(b, now), 0);
});

test("outcome: no answer is never 'not sent'", () => {
  assert.equal(submitOutcome({ ok: true }), "accepted");
  assert.equal(submitOutcome({ ok: false, status: 0, unknown: true }), "unknown"); // timeout / network
  assert.equal(submitOutcome({ ok: false, status: 504 }), "unknown");
  assert.equal(submitOutcome({ ok: false, status: 502 }), "unknown");
  assert.equal(submitOutcome({ ok: false, status: 500 }), "unknown");
  assert.equal(submitOutcome({ ok: false, status: 202, unknown: true }), "unknown"); // unreadable answer
  assert.equal(submitOutcome({ ok: false, status: 400 }), "rejected");
  assert.equal(submitOutcome({ ok: false, status: 422 }), "rejected");
  assert.equal(submitOutcome({ ok: false, status: 503 }), "rejected");
});

test("after asking LHDN: record it, wait inside the window, clear once it is over", () => {
  const since = ago(60_000);
  assert.equal(unconfirmedNext({ found: true, since, now }), "record");
  assert.equal(unconfirmedNext({ found: false, since, now }), "wait");
  assert.equal(unconfirmedNext({ found: false, since: ago(UNCONFIRMED_WAIT_MS + 1), now }), "clear");
  assert.equal(unconfirmedUntil(since).getTime(), since.getTime() + UNCONFIRMED_WAIT_MS);
  assert.equal(unconfirmedUntil(null), null);
});

test("pickSentDocument: our number only, a live document first, then the newest", () => {
  const rows = [
    { uuid: "OTHER", internalId: "INV20261114002", status: "Valid", dateTimeReceived: "2026-11-14T05:59:00Z" },
    { uuid: "OLDBAD", internalId: "INV20261114001", status: "Invalid", dateTimeReceived: "2026-11-14T05:59:30Z" },
    { uuid: "GOOD", internalId: "INV20261114001", status: "Valid", submissionUID: "SUB1", longId: "LONG1", dateTimeReceived: "2026-11-14T05:59:10Z" },
  ];
  assert.deepEqual(pickSentDocument(rows, "INV20261114001"), { uuid: "GOOD", submissionUid: "SUB1", longId: "LONG1", status: "valid" });
  assert.deepEqual(pickSentDocument([rows[1]], "INV20261114001"), { uuid: "OLDBAD", submissionUid: null, longId: null, status: "invalid" });
  assert.equal(pickSentDocument(rows, "INV20261114009"), null);
  assert.equal(pickSentDocument(null, "X"), null);
});

// ---------------------------------------------------------------------------
// Fix round: the lookup after an unanswered submission
// ---------------------------------------------------------------------------

test("an earlier, ended attempt with the same number is not taken for the unanswered one", () => {
  // Submitted, LHDN said invalid, fixed and resubmitted within a minute; that resubmit timed out.
  // LHDN's list only shows the earlier invalid document so far.
  const since = ago(60_000);
  const rows = [{ uuid: "FIRST", internalId: "INV20261114001", status: "Invalid", dateTimeReceived: ago(90_000).toISOString() }];
  const doc = pickSentDocument(rows, "INV20261114001");
  const next = (at) => unconfirmedNext({ found: !!doc, foundLive: isLiveStatus(doc.status), complete: true, since, now: at });
  // It used to be recorded at once (marker cleared, third submit allowed): now it waits.
  assert.equal(next(now), "wait");
  // Once the wait is over, nothing LHDN counts exists: recording it allows a corrected submission.
  assert.equal(next(new Date(since.getTime() + UNCONFIRMED_WAIT_MS + 1)), "record");
  // A document LHDN counts is recorded straight away (whichever attempt it is).
  assert.equal(unconfirmedNext({ found: true, foundLive: true, complete: true, since, now }), "record");
});

test("a list cut short is never read as 'not sent'", () => {
  const late = ago(UNCONFIRMED_WAIT_MS + 1);
  assert.equal(unconfirmedNext({ found: false, complete: false, since: late, now }), "unsure");
  assert.equal(unconfirmedNext({ found: true, foundLive: false, complete: false, since: late, now }), "unsure");
  assert.equal(unconfirmedNext({ found: false, complete: true, since: late, now }), "clear");
  // Inside the wait it simply waits.
  assert.equal(unconfirmedNext({ found: false, complete: false, since: ago(60_000), now }), "wait");
});

test("lookup window: a short window around the attempt, however late Check Status is pressed", () => {
  const since = ago(5 * 60_000);
  const w = sentLookupWindow(since, now);
  assert.equal(w.source, "recent");
  assert.equal(w.from.getTime(), since.getTime() - LOOKUP_BEFORE_MS);
  assert.equal(w.to.getTime(), now.getTime()); // never in the future
  // Pressed a week later: still only the time around the attempt (not a week of documents).
  const later = new Date(since.getTime() + 7 * 24 * 3600_000);
  const w2 = sentLookupWindow(since, later);
  assert.equal(w2.to.getTime(), since.getTime() + LOOKUP_AFTER_MS);
  assert.ok(w2.to.getTime() - w2.from.getTime() <= LOOKUP_BEFORE_MS + LOOKUP_AFTER_MS);
});

test("lookup window: attempts older than LHDN's 31-day 'recent' list use 'search documents'", () => {
  const since = new Date(now.getTime() - 40 * 24 * 3600_000);
  const w = sentLookupWindow(since, now);
  assert.equal(w.source, "search");
  // LHDN allows at most 30 days per search: the window is about an hour.
  assert.ok(w.to.getTime() - w.from.getTime() < 2 * 3600_000);
  assert.equal(sentLookupWindow(new Date(now.getTime() - 20 * 24 * 3600_000), now).source, "recent");
  // No attempt time (should not happen): the last few minutes, still a valid range.
  const w3 = sentLookupWindow(null, now);
  assert.ok(w3.to > w3.from);
});

test("claim: an invoice taken into a consolidated e-Invoice after it was read cannot be claimed", () => {
  const row = { id: "o1", eInvoiceUuid: null, eInvoiceStatus: null, eInvoiceSubmittingAt: null, consolidatedId: null };
  const where = claimWhere(row, now, { consolidatedId: row.consolidatedId });
  assert.equal(where.consolidatedId, null);
  assert.equal(where.id, "o1"); // extra never replaces the record's own conditions
  const matches = (r, w) =>
    r.id === w.id && r.consolidatedId === w.consolidatedId && r.eInvoiceUuid === w.eInvoiceUuid &&
    r.eInvoiceStatus === w.eInvoiceStatus && w.OR.some((c) => (c.eInvoiceSubmittingAt === null ? r.eInvoiceSubmittingAt === null : false));
  // Meanwhile the monthly consolidated e-Invoice reserved the invoice.
  const now1 = { ...row, consolidatedId: "con1" };
  assert.equal(matches(now1, where), false);
  assert.equal(matches(row, where), true);
});

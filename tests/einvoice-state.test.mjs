import test from "node:test";
import assert from "node:assert/strict";
import { isLiveStatus, isLiveEInvoice, isLiveIn, isReportedFor, envFromSandboxFlag, recordEnv } from "../src/lib/einvoice-state.mjs";

const rec = (over = {}) => ({ eInvoiceUuid: "ABC123DEF456", eInvoiceStatus: "valid", eInvoiceEnv: "production", ...over });

test("ended LHDN statuses no longer count", () => {
  for (const s of ["valid", "pending", "submitted", null, ""]) assert.equal(isLiveStatus(s), true, String(s));
  for (const s of ["invalid", "Cancelled", "rejected"]) assert.equal(isLiveStatus(s), false, s);
});

test("sandbox results are never a real e-Invoice (H1)", () => {
  assert.equal(isLiveEInvoice(rec()), true);
  assert.equal(isLiveEInvoice(rec({ eInvoiceEnv: "sandbox" })), false);
  assert.equal(isLiveEInvoice(rec({ eInvoiceStatus: "invalid" })), false);
  assert.equal(isLiveEInvoice(rec({ eInvoiceUuid: null })), false);
  // Saved before v0.3.29 (no environment): keeps the old meaning.
  assert.equal(isLiveEInvoice(rec({ eInvoiceEnv: null })), true);
});

test("double submission is judged per environment", () => {
  assert.equal(isLiveIn(rec({ eInvoiceEnv: "sandbox" }), "sandbox"), true);
  assert.equal(isLiveIn(rec({ eInvoiceEnv: "sandbox" }), "production"), false);
  assert.equal(isLiveIn(rec(), "sandbox"), false);
});

test("what counts as already reported depends on where you are working", () => {
  const sandboxed = rec({ eInvoiceEnv: "sandbox" });
  assert.equal(isReportedFor(sandboxed, "production"), false, "a sandbox test must not hide a real sale");
  assert.equal(isReportedFor(sandboxed, "sandbox"), true);
  assert.equal(isReportedFor(rec(), "sandbox"), true, "a real e-Invoice counts everywhere");
});

test("environment helpers", () => {
  assert.equal(envFromSandboxFlag(true), "sandbox");
  assert.equal(envFromSandboxFlag(undefined), "sandbox");
  assert.equal(envFromSandboxFlag(false), "production");
  assert.equal(recordEnv({ eInvoiceEnv: null }), "production");
  assert.equal(recordEnv({ eInvoiceEnv: "sandbox" }), "sandbox");
});

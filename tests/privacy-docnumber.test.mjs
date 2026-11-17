import test from "node:test";
import assert from "node:assert/strict";
import { nextSequenceNumber, numbersToRetire, lostEInvoices, countByKind, DOC_NUMBER_SOURCES, safetyCopyLocation } from "../src/lib/privacy-docnumber.mjs";

test("next number of the day is one more than the highest in use", () => {
  assert.equal(nextSequenceNumber("INV20261114", []), "INV20261114001");
  assert.equal(nextSequenceNumber("INV20261114", ["INV20261114001", "INV20261114002"]), "INV20261114003");
  // Numeric, not text order: 1000 comes after 999.
  assert.equal(nextSequenceNumber("WO20261114", ["WO20261114999", "WO20261114100"]), "WO20261114" + "1000");
  // Other days and other prefixes are ignored.
  assert.equal(nextSequenceNumber("RC20261114", ["RC20261113009", "INV20261114005", null]), "RC20261114001");
});

test("numbers retired after a restore are never issued again", () => {
  // The restore rolled the database back to INV...002, but 003-005 were already printed.
  const used = ["INV20261114001", "INV20261114002"];
  const retired = ["INV20261114003", "INV20261114004", "INV20261114005"];
  assert.equal(nextSequenceNumber("INV20261114", used, retired), "INV20261114006");
  // A retired number from another day does not move today's numbering.
  assert.equal(nextSequenceNumber("CN20261114", [], ["CN20261113007"]), "CN20261114001");
  // Once new documents pass the retired ones, numbering simply continues.
  assert.equal(nextSequenceNumber("PV20261114", ["PV20261114007"], ["PV20261114005"]), "PV20261114008");
});

test("numbers to retire: in the safety copy but not in the restored database", () => {
  const safety = {
    WO: ["WO20261114001", "WO20261114002", "WO20261114003"],
    INV: ["INV20261114001", "INV20261114002"],
    CN: ["CN20261114001"],
    SI: [],
    PV: ["PV20261114001"],
  };
  const restored = { WO: ["WO20261114001"], INV: [], CN: ["CN20261114001"], PV: ["PV20261114001"] };
  const out = numbersToRetire(safety, restored);
  assert.deepEqual(out, [
    { kind: "WO", number: "WO20261114002" },
    { kind: "WO", number: "WO20261114003" },
    { kind: "INV", number: "INV20261114001" },
    { kind: "INV", number: "INV20261114002" },
  ]);
  assert.deepEqual(countByKind(out), { WO: 2, INV: 2 });
  // Running it again against a database that already has them changes nothing.
  assert.deepEqual(numbersToRetire({ INV: ["INV1"] }, { INV: ["INV1"] }), []);
});

test("every kind of document number is covered", () => {
  assert.deepEqual(DOC_NUMBER_SOURCES.map((s) => s.kind), ["WO", "QT", "INV", "RC", "CN", "SI", "PV"]);
});

test("e-Invoices only in the safety copy are listed for re-entry, once each", () => {
  const safetyDocs = [
    { kind: "invoice", number: "INV1", uuid: "UUID-A", env: "production", status: "valid" },
    { kind: "invoice", number: "INV2", uuid: "UUID-B", env: "sandbox", status: "valid" },
    { kind: "credit note", number: "CN1", uuid: "UUID-C", env: "production", status: "valid" },
    { kind: "invoice", number: "INV3", uuid: null },
    { kind: "consolidated", number: "CON-202610", uuid: "UUID-A" },
  ];
  const lost = lostEInvoices(safetyDocs, ["UUID-C", null]);
  assert.deepEqual(lost.map((d) => d.uuid), ["UUID-A", "UUID-B"]);
});

test("the safety copy of a restore is found in backups/auto, or as the raw files of an emergency restore", () => {
  assert.deepEqual(safetyCopyLocation("workshop-auto-20261114-101010-pre-restore.db"), {
    kind: "auto",
    parts: ["auto", "workshop-auto-20261114-101010-pre-restore.db"],
  });
  // An emergency restore during a write (hot journal) keeps the raw files: still compared, so the
  // numbers issued after the backup are retired and lost e-Invoices are listed.
  for (const sep of ["/", "\\"]) {
    assert.deepEqual(safetyCopyLocation(`damaged${sep}workshop-before-emergency-restore-20261114-101010`), {
      kind: "raw",
      parts: ["damaged", "workshop-before-emergency-restore-20261114-101010"],
    });
  }
  // Never a path from elsewhere.
  for (const bad of ["../workshop.db", "a/b.db", "a\\b.db", "damaged/../workshop.db", "damaged/workshop-before-emergency-restore-x/../../y",
    "damaged/other-folder", "workshop.txt", "", null, 42]) {
    assert.equal(safetyCopyLocation(bad), null, String(bad));
  }
});

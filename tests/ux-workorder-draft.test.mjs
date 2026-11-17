import test from "node:test";
import assert from "node:assert/strict";
import {
  DRAFT_MAX_AGE_MS,
  autosaveDraft,
  browserStorage,
  clearDraft,
  draftStorageKey,
  hasDraft,
  isDraftWorthKeeping,
  loadDraft,
  parseDraft,
  pruneDrafts,
  saveDraft,
} from "../src/lib/ux-workorder-draft.mjs";

// A Map-backed stand-in for window.localStorage.
function memoryStorage() {
  const m = new Map();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    raw: m,
  };
}

// Storage that refuses everything (private window, blocked site data).
const brokenStorage = {
  get length() {
    throw new Error("blocked");
  },
  key() {
    throw new Error("blocked");
  },
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
  removeItem() {
    throw new Error("blocked");
  },
};

const NOW = Date.UTC(2026, 10, 14, 3, 0, 0);
const form = {
  plate: "WXY1234",
  make: "Perodua",
  model: "Myvi",
  customerName: "Ali",
  phone: "012-345 6789",
  mileage: "45000",
  description: "Engine noise",
  diagnosis: "",
  discount: 5,
  items: [
    { id: "a1", type: "PART", description: "Oil filter", quantity: 1, unitPrice: 25, costPrice: 11.37, inventoryItemId: "inv-1" },
    { id: "a2", type: "LABOR", description: "Labour", quantity: 1, unitPrice: 40, inventoryItemId: "inv-2" },
  ],
};

test("a draft is saved per user and restored with what was typed", () => {
  const s = memoryStorage();
  assert.equal(saveDraft(s, "user-a", form, NOW), true);
  const d = loadDraft(s, "user-a", NOW + 60_000);
  assert.ok(d);
  assert.equal(d.savedAt, NOW);
  assert.equal(d.form.plate, "WXY1234");
  assert.equal(d.form.customerName, "Ali");
  assert.equal(d.form.discount, 5);
  assert.deepEqual(d.form.items, [
    { type: "PART", description: "Oil filter", quantity: 1, unitPrice: 25, inventoryItemId: "inv-1" },
    // Labour never keeps a stock link.
    { type: "LABOR", description: "Labour", quantity: 1, unitPrice: 40, inventoryItemId: null },
  ]);
  assert.equal(hasDraft(s, "user-a", NOW), true);
});

test("the boss-only cost price is never written to the browser", () => {
  const s = memoryStorage();
  saveDraft(s, "owner-1", form, NOW);
  const raw = s.getItem(draftStorageKey("owner-1"));
  assert.ok(raw);
  assert.ok(!raw.includes("costPrice"));
  assert.ok(!raw.includes("11.37"));
});

test("another user on the same computer does not see the draft", () => {
  const s = memoryStorage();
  saveDraft(s, "user-a", form, NOW);
  assert.equal(loadDraft(s, "user-b", NOW), null);
  assert.equal(hasDraft(s, "user-b", NOW), false);
  assert.notEqual(draftStorageKey("user-a"), draftStorageKey("user-b"));
  // No user id (not signed in): nothing is stored or read.
  assert.equal(draftStorageKey(""), null);
  assert.equal(saveDraft(s, "", form, NOW), false);
  assert.equal(loadDraft(s, "", NOW), null);
});

test("an untouched form is not kept, and clearing the form removes the draft", () => {
  const s = memoryStorage();
  const empty = { plate: "", items: [{ type: "PART", description: "", quantity: 1, unitPrice: 0 }], discount: 0 };
  assert.equal(isDraftWorthKeeping(empty), false);
  saveDraft(s, "u", empty, NOW);
  assert.equal(s.raw.size, 0);
  saveDraft(s, "u", form, NOW);
  assert.equal(s.raw.size, 1);
  saveDraft(s, "u", empty, NOW + 1000);
  assert.equal(s.raw.size, 0);
  saveDraft(s, "u", form, NOW);
  clearDraft(s, "u");
  assert.equal(loadDraft(s, "u", NOW), null);
});

test("an expired or damaged draft is not offered and is removed", () => {
  const s = memoryStorage();
  saveDraft(s, "u", form, NOW);
  assert.ok(loadDraft(s, "u", NOW + DRAFT_MAX_AGE_MS - 1));
  assert.equal(loadDraft(s, "u", NOW + DRAFT_MAX_AGE_MS + 1), null);
  assert.equal(s.raw.size, 0);

  s.setItem(draftStorageKey("u"), "{not json");
  assert.equal(loadDraft(s, "u", NOW), null);
  assert.equal(s.raw.size, 0);

  assert.equal(parseDraft(JSON.stringify({ v: 99, savedAt: NOW, form }), NOW), null);
  assert.equal(parseDraft(JSON.stringify({ v: 1, savedAt: NOW + 2 * 3600_000, form }), NOW), null);
});

test("odd stored values are cleaned up when read", () => {
  const raw = JSON.stringify({
    v: 1,
    savedAt: NOW,
    form: {
      plate: "X".repeat(50),
      description: 42,
      discount: -3,
      items: [{ type: "HACK", description: "Bolt", quantity: -2, unitPrice: Infinity }, null, "x"],
    },
  });
  const d = parseDraft(raw, NOW);
  assert.ok(d);
  assert.equal(d.form.plate.length, 20);
  assert.equal(d.form.description, "");
  assert.equal(d.form.discount, 0);
  assert.deepEqual(d.form.items, [{ type: "PART", description: "Bolt", quantity: 0, unitPrice: 0, inventoryItemId: null }]);
});

test("blocked browser storage never breaks the page", () => {
  assert.equal(saveDraft(brokenStorage, "u", form, NOW), false);
  assert.equal(loadDraft(brokenStorage, "u", NOW), null);
  assert.equal(hasDraft(brokenStorage, "u", NOW), false);
  assert.doesNotThrow(() => clearDraft(brokenStorage, "u"));
  assert.equal(pruneDrafts(brokenStorage, NOW), 0);
  assert.equal(saveDraft(null, "u", form, NOW), false);
  // No window in Node: no storage, no error.
  assert.equal(browserStorage(), null);
});

test("old drafts of every user are removed; fresh ones and other settings stay", () => {
  const s = memoryStorage();
  saveDraft(s, "old-user", form, NOW - DRAFT_MAX_AGE_MS - 1);
  saveDraft(s, "fresh-user", form, NOW - 1000);
  s.setItem("workshop-lang", "zh");
  assert.equal(pruneDrafts(s, NOW), 1);
  assert.equal(s.getItem(draftStorageKey("old-user")), null);
  assert.ok(s.getItem(draftStorageKey("fresh-user")));
  assert.equal(s.getItem("workshop-lang"), "zh");
});

// Storage that is full: reading works, writing fails (QuotaExceededError).
function fullStorage(base) {
  return {
    get length() {
      return base.length;
    },
    key: (i) => base.key(i),
    getItem: (k) => base.getItem(k),
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem: (k) => base.removeItem(k),
  };
}

const blank = { plate: "", items: [{ type: "PART", description: "", quantity: 1, unitPrice: 0 }], discount: 0 };

test("typing under the Restore draft offer is saved, so a logout keeps today's job", () => {
  const s = memoryStorage();
  const old = { ...form, plate: "OLD1" };
  saveDraft(s, "u", old, NOW - 86_400_000);
  const offer = loadDraft(s, "u", NOW);
  assert.equal(offer.form.plate, "OLD1");

  // Page opened, nothing typed yet: the offered draft stays stored, nothing new is "kept".
  assert.equal(autosaveDraft(s, "u", blank, NOW, offer), false);
  assert.equal(loadDraft(s, "u", NOW).form.plate, "OLD1");

  // The user ignores the banner and types a new job: that is what is stored now.
  const typed = { ...blank, plate: "NEW9", customerName: "Tan", items: [{ type: "PART", description: "Brake pads", quantity: 1, unitPrice: 120 }] };
  assert.equal(autosaveDraft(s, "u", typed, NOW + 1000, offer), true);
  assert.equal(hasDraft(s, "u", NOW + 2000), true);
  const kept = loadDraft(s, "u", NOW + 2000);
  assert.equal(kept.form.plate, "NEW9");
  assert.equal(kept.form.items[0].description, "Brake pads");

  // Everything typed is deleted again while the offer is still open: the offered draft is back.
  assert.equal(autosaveDraft(s, "u", blank, NOW + 3000, offer), false);
  const back = loadDraft(s, "u", NOW + 4000);
  assert.equal(back.form.plate, "OLD1");
  assert.equal(back.savedAt, offer.savedAt);

  // Offer closed (restored or discarded) and the form emptied: no draft is left.
  assert.equal(autosaveDraft(s, "u", blank, NOW + 5000, null), false);
  assert.equal(hasDraft(s, "u", NOW + 5000), false);
});

test("the 'Draft kept' note is only shown when the draft was really stored", () => {
  const s = memoryStorage();
  assert.equal(autosaveDraft(s, "u", form, NOW, null), true);
  // Full storage: the newer form could not be written, so it is not reported as kept.
  assert.equal(autosaveDraft(fullStorage(s), "u", { ...form, plate: "NEW9" }, NOW + 1000, null), false);
  assert.equal(loadDraft(s, "u", NOW + 1000).form.plate, "WXY1234");
  assert.equal(autosaveDraft(brokenStorage, "u", form, NOW, null), false);
  assert.equal(autosaveDraft(null, "u", form, NOW, null), false);
  // Not signed in: nothing is stored.
  assert.equal(autosaveDraft(s, "", form, NOW, null), false);
  // An empty form is never "kept".
  assert.equal(autosaveDraft(memoryStorage(), "u", blank, NOW, null), false);
});

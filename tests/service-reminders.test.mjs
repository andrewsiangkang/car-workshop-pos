import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  reminderEligibility,
  whatsappNumber,
  isPlaceholderName,
  reminderLanguage,
  reminderMessage,
  reminderLink,
} from "../src/lib/privacy-reminders.mjs";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("service reminder fields are part of the Vehicle model and safe schema upgrade", () => {
  const schema = read("prisma/schema.prisma");
  const upgrade = read("src/lib/schema-upgrade.ts");
  for (const field of ["lastServiceDate", "lastServiceMileage", "nextServiceDate", "nextServiceMileage", "serviceIntervalKm", "serviceIntervalMonths"]) {
    assert.ok(schema.includes(field), `missing Prisma field ${field}`);
    assert.ok(upgrade.includes(`column: "${field}"`), `missing additive upgrade for ${field}`);
  }
});

const agreed = { phone: "012-345 6789", reminderConsentAt: "2026-11-01T00:00:00Z", reminderOptOutAt: null, anonymisedAt: null };

test("reminders are offered only with a consent record and no opt-out", () => {
  assert.deepEqual(reminderEligibility(agreed), { ok: true });
  assert.deepEqual(reminderEligibility({ ...agreed, reminderConsentAt: null }), { ok: false, reason: "NO_CONSENT" });
  assert.deepEqual(reminderEligibility({ ...agreed, reminderOptOutAt: "2026-11-05T00:00:00Z" }), { ok: false, reason: "OPTED_OUT" });
  assert.deepEqual(reminderEligibility({ ...agreed, anonymisedAt: "2026-11-06T00:00:00Z" }), { ok: false, reason: "ANONYMISED" });
  assert.deepEqual(reminderEligibility({ ...agreed, phone: "N/A" }), { ok: false, reason: "NO_PHONE" });
});

test("WhatsApp numbers: Malaysian 0… numbers get 60, placeholders give nothing", () => {
  assert.equal(whatsappNumber("012-345 6789"), "60123456789");
  assert.equal(whatsappNumber("+60 12-345 6789"), "60123456789");
  assert.equal(whatsappNumber("+65 9123 4567"), "6591234567");
  for (const v of ["N/A", "-", "", null, "000-0000000"]) assert.equal(whatsappNumber(v), "", String(v));
});

test("walk-in and placeholder names are never used in a greeting", () => {
  for (const n of ["Walk-in (WXY1234)", "walk in", "WALKIN", "N/A", "-", "", "Anonymised customer", "General Public", "WXY 1234"]) {
    assert.equal(isPlaceholderName(n, "WXY1234"), true, n);
  }
  for (const n of ["Tan Ah Kow", "Siti Aminah", "Walker Lim"]) assert.equal(isPlaceholderName(n, "WXY1234"), false, n);
});

test("language: the customer's choice, else the shop's locale, else English", () => {
  assert.equal(reminderLanguage("ms", "zh-MY"), "ms");
  assert.equal(reminderLanguage(null, "zh-MY"), "zh");
  assert.equal(reminderLanguage("", "ms-MY"), "ms");
  assert.equal(reminderLanguage(undefined, "en-MY"), "en");
  assert.equal(reminderLanguage("fr", "th-TH"), "en");
});

const base = { plate: "WXY1234", make: "Perodua", model: "Myvi", dueDate: "14/12/2026", dueKm: 45000, shopName: "Ah Seng Motor" };

test("messages in English, Chinese and Malay, each with the plate, due date and how to stop", () => {
  const en = reminderMessage({ ...base, language: "en", name: "Tan Ah Kow" });
  assert.match(en, /^Hi Tan Ah Kow, this is a reminder from Ah Seng Motor\./);
  assert.ok(en.includes("WXY1234 (Perodua Myvi)") && en.includes("14/12/2026") && en.includes("45,000 km") && en.includes("STOP"));
  const zh = reminderMessage({ ...base, language: "zh", name: "陈先生" });
  assert.ok(zh.startsWith("陈先生，您好！") && zh.includes("WXY1234") && zh.includes("保养") && zh.includes("STOP"));
  const ms = reminderMessage({ ...base, language: "ms", name: "Siti" });
  assert.ok(ms.startsWith("Salam Siti,") && ms.includes("WXY1234") && ms.includes("diservis") && ms.includes("STOP"));
});

test("a walk-in gets a neutral greeting with the plate number, never 'Walk-in (PLATE)'", () => {
  for (const language of ["en", "zh", "ms"]) {
    const m = reminderMessage({ ...base, language, name: "Walk-in (WXY1234)" });
    assert.ok(!/walk-?in/i.test(m), `${language}: ${m}`);
    assert.ok(m.includes("WXY1234"), language);
  }
  assert.match(reminderMessage({ ...base, language: "en", name: "Walk-in (WXY1234)" }), /^Hello, /);
  assert.match(reminderMessage({ ...base, language: "zh", name: "" }), /^您好！/);
  assert.match(reminderMessage({ ...base, language: "ms", name: null }), /^Salam sejahtera, /);
});

test("the WhatsApp link exists only for customers who may be messaged", () => {
  const link = reminderLink(agreed, { ...base, language: "en", name: "Tan" });
  assert.ok(link.startsWith("https://wa.me/60123456789?text="));
  assert.ok(decodeURIComponent(link.split("text=")[1]).startsWith("Hi Tan,"));
  assert.equal(reminderLink({ ...agreed, reminderConsentAt: null }, { ...base, language: "en" }), "");
  assert.equal(reminderLink({ ...agreed, reminderOptOutAt: "2026-11-05T00:00:00Z" }, { ...base, language: "en" }), "");
});

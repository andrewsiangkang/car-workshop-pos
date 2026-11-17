// Draft of the "New Work Order" form, kept in this browser so the 5-minute idle logout (or a closed
// window) does not throw away a half-filled job. One draft per user account (key includes the user id),
// kept for at most DRAFT_MAX_AGE_MS. Cost prices are never stored: they are boss-only and the server
// looks them up itself for parts linked to inventory. Every storage access is wrapped in try/catch
// (private window, blocked storage, full disk): the form then simply works without a draft.
// 【中文】新工单草稿：存在本机浏览器里（按用户分开，最多保留 3 天），自动登出后可以恢复；不保存成本价。

export const DRAFT_VERSION = 1;
export const DRAFT_KEY_PREFIX = "workshop-wo-draft:";
export const DRAFT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const MAX_ITEMS = 200;

const TEXT_LIMITS = {
  plate: 20,
  make: 100,
  model: 100,
  customerName: 200,
  phone: 50,
  mileage: 12,
  description: 2000,
  diagnosis: 2000,
};

/** Storage key for this user's draft, or null when the user is not known (then nothing is stored). */
export function draftStorageKey(userId) {
  const id = typeof userId === "string" ? userId.trim() : "";
  return id ? DRAFT_KEY_PREFIX + id : null;
}

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

function cleanItem(it) {
  if (!it || typeof it !== "object") return null;
  return {
    type: it.type === "LABOR" ? "LABOR" : "PART",
    description: str(it.description, 500),
    quantity: Math.min(100000, num(it.quantity)),
    unitPrice: Math.min(10_000_000, num(it.unitPrice)),
    // Labour never links to stock (same rule as the form and the server).
    inventoryItemId: it.type !== "LABOR" && typeof it.inventoryItemId === "string" && it.inventoryItemId ? it.inventoryItemId : null,
  };
}

/**
 * The form fields worth keeping: only what the user typed or picked, never a cost price or a line id.
 * @param {object} form
 */
export function draftFields(form) {
  const f = form && typeof form === "object" ? form : {};
  const out = {};
  for (const [k, max] of Object.entries(TEXT_LIMITS)) out[k] = str(f[k], max);
  out.discount = Math.min(10_000_000, num(f.discount));
  out.items = (Array.isArray(f.items) ? f.items : []).slice(0, MAX_ITEMS).map(cleanItem).filter(Boolean);
  return out;
}

/** True when the form holds anything a user would miss (an untouched form is not kept). */
export function isDraftWorthKeeping(form) {
  const f = draftFields(form);
  if (Object.keys(TEXT_LIMITS).some((k) => f[k].trim())) return true;
  if (f.discount > 0) return true;
  return f.items.some((i) => i.description.trim() || i.unitPrice > 0 || !!i.inventoryItemId);
}

/** JSON text to store for this form at time `now` (ms). */
export function serializeDraft(form, now) {
  return JSON.stringify({ v: DRAFT_VERSION, savedAt: now, form: draftFields(form) });
}

/**
 * Read a stored draft. Returns null for a missing, damaged, old-version or expired draft.
 * @returns {{ savedAt: number, form: ReturnType<typeof draftFields> } | null}
 */
export function parseDraft(raw, now) {
  if (typeof raw !== "string" || !raw) return null;
  let d;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!d || typeof d !== "object" || d.v !== DRAFT_VERSION) return null;
  const savedAt = Number(d.savedAt);
  if (!Number.isFinite(savedAt)) return null;
  // Expired, or dated in the future (clock changed): not offered.
  if (now - savedAt > DRAFT_MAX_AGE_MS || savedAt - now > 60 * 60 * 1000) return null;
  const form = draftFields(d.form);
  if (!isDraftWorthKeeping(form)) return null;
  return { savedAt, form };
}

/** Save (or, for an empty form, remove) this user's draft. Returns false when storage failed. */
export function saveDraft(storage, userId, form, now) {
  const key = draftStorageKey(userId);
  if (!key || !storage) return false;
  try {
    if (isDraftWorthKeeping(form)) storage.setItem(key, serializeDraft(form, now));
    else storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Autosave of the New Work Order page, run on every change.
 * `offer` is the draft offered by the "Restore draft" banner (null once restored or discarded).
 * While the offer is open and nothing has been typed, the offered draft stays stored (a logout keeps it).
 * As soon as the form holds something, the form is stored instead: what the user typed last is what
 * a logout keeps (the offered draft can still be restored from the banner while the page is open).
 * Returns true only when the current form is really stored (false when storage failed or it is empty).
 * 【中文】自动保存：恢复提示还在、表单还空着时保留旧草稿；一旦开始输入就改存当前内容。只有真的存进去才返回 true。
 * @param {{ savedAt: number, form: object } | null | undefined} offer
 */
export function autosaveDraft(storage, userId, form, now, offer) {
  if (offer && !isDraftWorthKeeping(form)) {
    // Puts the offered draft back if something typed earlier replaced it and was then deleted again.
    saveDraft(storage, userId, offer.form, offer.savedAt);
    return false;
  }
  return saveDraft(storage, userId, form, now) && isDraftWorthKeeping(form);
}

/** This user's draft, or null. A damaged or expired draft is removed. */
export function loadDraft(storage, userId, now) {
  const key = draftStorageKey(userId);
  if (!key || !storage) return null;
  let raw = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw == null) return null;
  const d = parseDraft(raw, now);
  if (!d) clearDraft(storage, userId);
  return d;
}

export function hasDraft(storage, userId, now) {
  return loadDraft(storage, userId, now) !== null;
}

export function clearDraft(storage, userId) {
  const key = draftStorageKey(userId);
  if (!key || !storage) return;
  try {
    storage.removeItem(key);
  } catch {}
}

/** Remove expired or damaged drafts of every user on this computer (customer details do not linger). */
export function pruneDrafts(storage, now) {
  if (!storage) return 0;
  let removed = 0;
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(DRAFT_KEY_PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      if (!parseDraft(storage.getItem(k), now)) {
        storage.removeItem(k);
        removed++;
      }
    }
  } catch {}
  return removed;
}

/** window.localStorage, or null where the browser blocks it (reading the property itself can throw). */
export function browserStorage() {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

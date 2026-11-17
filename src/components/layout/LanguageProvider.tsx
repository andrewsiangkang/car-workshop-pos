"use client";

import { useEffect, useState } from "react";
import { DEFAULT_LANG, LANGS, isLang, translateText, type Lang } from "@/lib/i18n";
import { printedDocumentRule, type PrintedDocumentRule } from "@/lib/ux-i18n-core.mjs";

/**
 * 【中文】界面语言切换（中文 / English / Bahasa Melayu）。
 * 做法：页面渲染完成后，把页面上的英文文字按词典换成所选语言，并监听页面变化持续翻译；
 * 所选语言记在浏览器里。打印出去的单据本身（发票/收据/报价单/退款单/付款凭证）保持开单时的语言（英文），
 * 但这些页面上的按钮、电子发票表格、提示和错误信息照常翻译。
 * 词典在 src/lib/i18n-dict*.ts。
 *
 * The printed document itself (invoice, receipt, quotation, credit note, payment voucher) stays in
 * the language it is issued in (English, as LHDN and the customer get it). Everything else on those
 * pages (buttons, e-Invoice form, notes, errors) is translated like the rest of the app.
 * Printed areas are marked data-no-i18n; on the document pages the rule in printedDocumentRule()
 * also keeps an unmarked printed area in English (see ux-i18n-core.mjs).
 */
const KEY = "workshop-lang";
const ATTRS = ["placeholder", "title", "aria-label", "alt"];

const textOrig = new WeakMap<Node, string>();
const textShown = new WeakMap<Node, string>();
const attrOrig = new WeakMap<Element, Record<string, string>>();
const attrShown = new WeakMap<Element, Record<string, string>>();

function skipEl(el: Element | null, rule: PrintedDocumentRule) {
  if (!el) return true;
  const tag = el.tagName;
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "NOSCRIPT") return true;
  if (el.closest("[data-no-i18n]")) return true;
  if (rule.printArea && el.closest(".print-area")) return true;
  // A printable page without a .print-area (payment voucher): what is inside <main> and not
  // marked no-print is the printed body.
  if (rule.mainBody && el.closest("main") && !el.closest(".no-print")) return true;
  return false;
}

// Put back the English of a node translated earlier that is now in an area kept in English
// (e.g. translated a moment before the page address changed). 【中文】误翻的打印区域恢复原文。
function restoreText(node: Text) {
  if (textOrig.has(node) && textShown.get(node) === node.nodeValue) {
    const orig = textOrig.get(node)!;
    textOrig.delete(node);
    textShown.delete(node);
    if (node.nodeValue !== orig) node.nodeValue = orig;
  }
}

function restoreAttrs(el: Element) {
  const o = attrOrig.get(el);
  const s = attrShown.get(el);
  if (!o || !s) return;
  for (const a of Object.keys(o)) {
    if (el.getAttribute(a) === s[a] && s[a] !== o[a]) el.setAttribute(a, o[a]);
  }
  attrOrig.delete(el);
  attrShown.delete(el);
}

function doText(node: Text, lang: Lang) {
  const cur = node.nodeValue || "";
  // 如果文字被页面程序更新过（不是我们换的），就把新文字当作新的原文
  const orig = textOrig.has(node) && textShown.get(node) === cur ? textOrig.get(node)! : cur;
  const next = translateText(orig, lang);
  textOrig.set(node, orig);
  textShown.set(node, next);
  if (cur !== next) node.nodeValue = next;
}

function doAttrs(el: Element, lang: Lang) {
  const o = attrOrig.get(el) || {};
  const s = attrShown.get(el) || {};
  for (const a of ATTRS) {
    const cur = el.getAttribute(a);
    if (cur == null) continue;
    const orig = o[a] !== undefined && s[a] === cur ? o[a] : cur;
    const next = translateText(orig, lang);
    o[a] = orig;
    s[a] = next;
    if (cur !== next) el.setAttribute(a, next);
  }
  attrOrig.set(el, o);
  attrShown.set(el, s);
}

function translateTree(root: Node, lang: Lang, rule: PrintedDocumentRule) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n: Node | null = walker.currentNode;
  while (n) {
    if (n.nodeType === 3) {
      if (!skipEl(n.parentElement, rule)) doText(n as Text, lang);
      else restoreText(n as Text);
    } else if (n.nodeType === 1) {
      const el = n as Element;
      if (!skipEl(el, rule)) doAttrs(el, lang);
      else restoreAttrs(el);
    }
    n = walker.nextNode();
  }
}

export default function LanguageProvider() {
  const [lang, setLang] = useState<Lang>(DEFAULT_LANG);

  // 读取已保存的语言
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (isLang(v)) setLang(v);
    } catch {}
  }, []);

  // 翻译并持续监听页面变化
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
    const nativeAlert = window.alert.bind(window);
    const nativeConfirm = window.confirm.bind(window);
    // A native pop-up can leave the desktop app without keyboard focus: afterwards no text box accepts typing.
    // Ask the app window to take focus back, and put the cursor back where it was.
    const restoreFocus = (before: Element | null) => {
      try {
        (window as unknown as { workshopWindow?: { refocus: () => Promise<boolean> } }).workshopWindow?.refocus();
      } catch {}
      window.setTimeout(() => {
        window.focus();
        if (before instanceof HTMLElement && document.contains(before)) before.focus();
      }, 50);
    };
    window.alert = (m?: unknown) => {
      const before = document.activeElement;
      nativeAlert(translateText(String(m ?? ""), lang));
      restoreFocus(before);
    };
    window.confirm = (m?: string) => {
      const before = document.activeElement;
      const ok = nativeConfirm(translateText(String(m ?? ""), lang));
      restoreFocus(before);
      return ok;
    };

    let scheduled = false;
    let busy = false;
    const run = () => {
      scheduled = false;
      busy = true;
      try {
        translateTree(document.body, lang, printedDocumentRule(window.location.pathname, !!document.querySelector(".print-area")));
      } finally {
        observer.takeRecords();
        busy = false;
      }
    };
    const observer = new MutationObserver(() => {
      if (busy || scheduled) return;
      scheduled = true;
      requestAnimationFrame(run);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
    run();
    return () => {
      observer.disconnect();
      window.alert = nativeAlert;
      window.confirm = nativeConfirm;
    };
  }, [lang]);

  const choose = (v: string) => {
    if (!isLang(v)) return;
    try {
      localStorage.setItem(KEY, v);
    } catch {}
    setLang(v);
  };

  return (
    <div data-no-i18n className="fixed bottom-3 right-3 z-50 print:hidden">
      <select
        value={lang}
        onChange={(e) => choose(e.target.value)}
        aria-label="Language"
        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 shadow"
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </div>
  );
}

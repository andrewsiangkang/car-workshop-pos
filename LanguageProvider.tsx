"use client";

import { useEffect, useState } from "react";
import { DEFAULT_LANG, LANGS, isLang, translateText, type Lang } from "@/lib/i18n";

/**
 * 【中文】界面语言切换（中文 / English / Bahasa Melayu）。
 * 做法：页面渲染完成后，把页面上的英文文字按词典换成所选语言，并监听页面变化持续翻译；
 * 所选语言记在浏览器里。打印的发票/报价单/收据不翻译（保持原样）。
 * 词典在 src/lib/i18n-dict.ts。
 *
 * 已修复：编辑表单时因 MutationObserver + 全量 DOM 遍历导致卡顿/冻结的问题。
 * - 不再监听 characterData（打字不再触发全页翻译）
 * - 跳过 INPUT / SELECT / TEXTAREA / contenteditable
 * - 增加 debounce，避免连续触发
 */
const KEY = "workshop-lang";
const ATTRS = ["placeholder", "title", "aria-label", "alt"];
const NO_TRANSLATE_PATH = /\/(invoice|quotation|receipt)(\/|$)|\/credit-notes\/|\/payment-vouchers\/[^/]+$/;

const textOrig = new WeakMap<Node, string>();
const textShown = new WeakMap<Node, string>();
const attrOrig = new WeakMap<Element, Record<string, string>>();
const attrShown = new WeakMap<Element, Record<string, string>>();

function skipEl(el: Element | null) {
  if (!el) return true;
  const tag = el.tagName;
  // Skip scripts, styles, form controls and anything marked no-i18n
  if (
    tag === "SCRIPT" ||
    tag === "STYLE" ||
    tag === "TEXTAREA" ||
    tag === "INPUT" ||
    tag === "SELECT" ||
    tag === "NOSCRIPT" ||
    tag === "OPTION"
  ) {
    return true;
  }
  if (el.closest("[data-no-i18n]")) return true;
  // Extra safety: never touch form-related subtrees while user is typing
  if (el.closest("input, select, textarea, [contenteditable='true'], [contenteditable='']")) {
    return true;
  }
  return false;
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

function translateTree(root: Node, lang: Lang) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n: Node | null = walker.currentNode;
  while (n) {
    if (n.nodeType === 3) {
      if (!skipEl(n.parentElement)) doText(n as Text, lang);
    } else if (n.nodeType === 1) {
      const el = n as Element;
      if (!skipEl(el)) doAttrs(el, lang);
    }
    n = walker.nextNode();
  }
}

export default function LanguageProvider() {
  const [lang, setLang] = useState<Lang>(DEFAULT_LANG);
  const [skip, setSkip] = useState(false);

  // 读取已保存的语言
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (isLang(v)) setLang(v);
    } catch {}
    setSkip(NO_TRANSLATE_PATH.test(window.location.pathname));
  }, []);

  // 翻译并持续监听页面变化（已优化，避免编辑时卡顿）
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
    const nativeAlert = window.alert.bind(window);
    const nativeConfirm = window.confirm.bind(window);
    window.alert = (m?: unknown) => nativeAlert(translateText(String(m ?? ""), lang));
    window.confirm = (m?: string) => nativeConfirm(translateText(String(m ?? ""), lang));

    let scheduled = false;
    let busy = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const run = () => {
      scheduled = false;
      busy = true;
      try {
        setSkip(NO_TRANSLATE_PATH.test(window.location.pathname));
        if (!NO_TRANSLATE_PATH.test(window.location.pathname)) {
          translateTree(document.body, lang);
        }
      } finally {
        observer.takeRecords(); // clear any mutations caused by ourselves
        busy = false;
      }
    };

    const schedule = () => {
      if (busy || scheduled) return;
      scheduled = true;
      // Debounce to avoid running on every keystroke / rapid DOM update
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        requestAnimationFrame(run);
      }, 280);
    };

    const observer = new MutationObserver(schedule);

    // 关键：不再监听 characterData。打字（input 的 value 变化）不再触发全页翻译。
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      // characterData: true,   // ← 已移除，这是卡顿主因
      attributes: true,
      attributeFilter: ATTRS,
    });

    // 初次翻译
    run();

    return () => {
      observer.disconnect();
      if (debounceTimer) clearTimeout(debounceTimer);
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

  if (skip) return null;
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

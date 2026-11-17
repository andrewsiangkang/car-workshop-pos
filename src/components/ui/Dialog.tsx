"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { promptValueError } from "@/lib/accounts-core.mjs";

/*
 * In-page dialogs that replace window.prompt() / window.confirm().
 * prompt() does nothing in the Electron desktop app (it returns null), and native pop-ups can
 * leave the window without keyboard focus. These work the same in the app, a browser and on phones.
 * 【中文】页面内的对话框，取代 window.prompt() / confirm()：Electron 桌面版不支持 prompt()（直接返回空），
 * 原生弹窗还会让窗口失去键盘焦点。支持 Esc 取消、焦点管理、手机底部弹出。
 */

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

type ShellProps = {
  title: ReactNode;
  message?: ReactNode;
  /** Esc / Cancel / tapping outside are ignored while busy (a request is running). */
  busy?: boolean;
  onCancel: () => void;
  /** Tapping the dark area outside closes the dialog (off for dialogs where something is typed). */
  dismissOnBackdrop?: boolean;
  role?: "dialog" | "alertdialog";
  children: ReactNode;
};

// 【中文】对话框外壳：遮罩、Esc 取消、Tab 焦点不跑出对话框、关闭后焦点回到原来的按钮。
function ModalShell({ title, message, busy, onCancel, dismissOnBackdrop, role = "dialog", children }: ShellProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  // Latest callbacks for the key handler, without re-running the open / close effect.
  const latest = useRef({ onCancel, busy });
  useEffect(() => {
    latest.current = { onCancel, busy };
  });

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = panel.current;
    const t = window.setTimeout(() => {
      const first = box?.querySelector<HTMLElement>("[data-autofocus]") || box?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!latest.current.busy) latest.current.onCancel();
        return;
      }
      if (e.key !== "Tab" || !box) return;
      // Keep Tab inside the dialog.
      const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      if (before && document.contains(before)) before.focus();
    };
  }, []);

  return (
    <div
      className="no-print fixed inset-0 z-[90] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (dismissOnBackdrop && !busy && e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:max-w-md sm:rounded-2xl sm:pb-5"
      >
        <h2 id={titleId} className="text-base font-semibold text-slate-900">
          {title}
        </h2>
        {message && (
          <div id={messageId} className="mt-2 text-sm text-slate-600">
            {message}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function Buttons({
  busy,
  danger,
  confirmLabel,
  cancelLabel,
  onCancel,
  submit,
  onConfirm,
  autoFocusConfirm,
}: {
  busy?: boolean;
  danger?: boolean;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  onCancel: () => void;
  submit?: boolean;
  onConfirm?: () => void;
  autoFocusConfirm?: boolean;
}) {
  return (
    <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:min-h-0"
      >
        {cancelLabel}
      </button>
      <button
        type={submit ? "submit" : "button"}
        onClick={submit ? undefined : onConfirm}
        disabled={busy}
        data-autofocus={autoFocusConfirm ? "" : undefined}
        className={`min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60 sm:min-h-0 ${
          danger ? "bg-red-600 hover:bg-red-700" : "bg-blue-700 hover:bg-blue-800"
        }`}
      >
        {busy ? "Please wait..." : confirmLabel}
      </button>
    </div>
  );
}

function ErrorLine({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {text}
    </div>
  );
}

export type ConfirmDialogProps = {
  open: boolean;
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
  busy?: boolean;
  /** Error from the last attempt (e.g. the server's message); the dialog stays open. */
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Yes / No question. The caller closes it (open=false) when the action is done. */
// 【中文】确认对话框（是 / 否）。
export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null;
  const { title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger, busy, error, onConfirm, onCancel } = props;
  return (
    <ModalShell title={title} message={message} busy={busy} onCancel={onCancel} dismissOnBackdrop role="alertdialog">
      <ErrorLine text={error} />
      <Buttons
        busy={busy}
        danger={danger}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        onCancel={onCancel}
        onConfirm={onConfirm}
        autoFocusConfirm={!danger}
      />
    </ModalShell>
  );
}

export type PromptDialogProps = {
  open: boolean;
  title: ReactNode;
  message?: ReactNode;
  /** "text" (one line), "password" (masked) or "textarea" (several lines; Ctrl+Enter confirms). */
  mode?: "text" | "password" | "textarea";
  label?: ReactNode;
  placeholder?: string;
  initialValue?: string;
  /** Something other than spaces must be typed. */
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  /** password mode: ask for the password a second time and check that both match. */
  confirmField?: boolean;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  danger?: boolean;
  busy?: boolean;
  error?: string;
  /** Receives exactly what was typed (not trimmed). */
  onConfirm: (value: string) => void;
  onCancel: () => void;
};

/** Asks for one value (text, password or several lines). The caller closes it when done. */
// 【中文】输入对话框（单行 / 密码 / 多行），取代 window.prompt()。
export function PromptDialog(props: PromptDialogProps) {
  if (!props.open) return null;
  // Mounted only while open, so every opening starts with a fresh value.
  return <PromptBody {...props} />;
}

function PromptBody({
  title,
  message,
  mode = "text",
  label,
  placeholder,
  initialValue = "",
  required,
  minLength,
  maxLength,
  confirmField,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  danger,
  busy,
  error,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [again, setAgain] = useState("");
  const [problem, setProblem] = useState("");
  const inputId = useId();
  const againId = useId();
  const withConfirm = mode === "password" && !!confirmField;

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const p = promptValueError({ value, required, minLength, confirm: withConfirm, confirmValue: again });
    setProblem(p);
    if (!p) onConfirm(value);
  }

  const field =
    "w-full rounded-lg border border-slate-200 px-3 py-2.5 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:text-sm";

  return (
    <ModalShell title={title} message={message} busy={busy} onCancel={onCancel}>
      <form onSubmit={submit} className="mt-4 space-y-3" noValidate>
        <div>
          {label && (
            <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-slate-700">
              {label}
            </label>
          )}
          {mode === "textarea" ? (
            <textarea
              id={inputId}
              data-autofocus=""
              rows={3}
              value={value}
              maxLength={maxLength}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
              }}
              className={field}
            />
          ) : (
            <input
              id={inputId}
              data-autofocus=""
              type={mode === "password" ? "password" : "text"}
              autoComplete={mode === "password" ? "new-password" : "off"}
              autoCapitalize={mode === "password" ? "none" : undefined}
              value={value}
              maxLength={maxLength}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
              className={field}
            />
          )}
        </div>
        {withConfirm && (
          <div>
            <label htmlFor={againId} className="mb-1.5 block text-sm font-medium text-slate-700">
              Type the new password again
            </label>
            <input
              id={againId}
              type="password"
              autoComplete="new-password"
              autoCapitalize="none"
              value={again}
              maxLength={maxLength}
              onChange={(e) => setAgain(e.target.value)}
              className={field}
            />
          </div>
        )}
        <ErrorLine text={problem || error} />
        <Buttons busy={busy} danger={danger} confirmLabel={confirmLabel} cancelLabel={cancelLabel} onCancel={onCancel} submit />
      </form>
    </ModalShell>
  );
}

"use client";

interface HeaderProps {
  // A node, not only a string, so a page can keep the translatable words and a document number
  // in separate text nodes, e.g. <><span>Work Order</span> <span data-no-i18n>{no}</span></>.
  // 【中文】标题可以分成「可翻译的文字」和「单号」两段，单号不翻译。
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

export function Header({ title, description, actions }: HeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

import type { ReactNode } from "react";

export function MobileActionBar({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur sm:hidden"
      data-testid="mobile-sticky-action-bar"
    >
      <div className="mx-auto flex max-w-[800px] items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
          <p className="truncate text-xs text-slate-500">{description}</p>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </div>
  );
}

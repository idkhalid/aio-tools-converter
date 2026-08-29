import type { ReactNode } from "react";

type EdgeStateTone = "neutral" | "warning" | "danger";

export interface EdgeStateAction {
  label: string;
  ariaLabel?: string;
  href?: string;
  onClick?: () => void;
}

const toneStyles: Record<
  EdgeStateTone,
  { border: string; badge: string; detail: string; icon: string; glyph: string }
> = {
  neutral: {
    border: "border-slate-200",
    badge: "bg-slate-100 text-slate-600",
    detail: "border-slate-200 bg-slate-50/60",
    icon: "bg-slate-100 text-slate-500",
    glyph: "x",
  },
  warning: {
    border: "border-amber-200",
    badge: "bg-amber-100 text-amber-800",
    detail: "border-amber-200 bg-amber-50/60",
    icon: "bg-amber-100 text-amber-600",
    glyph: "?",
  },
  danger: {
    border: "border-red-200",
    badge: "bg-red-100 text-red-700",
    detail: "border-red-200 bg-red-50/60",
    icon: "bg-red-100 text-red-600",
    glyph: "!",
  },
};

function SecondaryAction({ action }: { action: EdgeStateAction }) {
  const className =
    "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-2.5 font-medium text-slate-700 shadow-sm transition hover:bg-slate-50";
  if (action.href) {
    return (
      <a className={className} href={action.href} aria-label={action.ariaLabel}>
        {action.label}
      </a>
    );
  }
  return (
    <button
      className={className}
      type="button"
      onClick={action.onClick}
      aria-label={action.ariaLabel}
    >
      {action.label}
    </button>
  );
}

export function EdgeStatePanel({
  tone,
  statusLabel,
  title,
  description,
  detailTitle,
  detailDescription,
  primaryAction,
  secondaryAction,
  children,
  alert = false,
}: {
  tone: EdgeStateTone;
  statusLabel: string;
  title: string;
  description: string;
  detailTitle: string;
  detailDescription: string;
  primaryAction: EdgeStateAction;
  secondaryAction: EdgeStateAction;
  children?: ReactNode;
  alert?: boolean;
}) {
  const styles = toneStyles[tone];
  return (
    <section
      ref={(node) => {
        if (alert) node?.focus();
      }}
      tabIndex={alert ? -1 : undefined}
      className={`mt-8 overflow-hidden rounded-[1.25rem] border bg-white p-5 shadow-sm outline-none sm:p-7 ${styles.border}`}
      role={alert ? "alert" : "status"}
      aria-live={alert ? "assertive" : "polite"}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[1.35rem] font-bold text-slate-950">{title}</h2>
          <p className="mt-1 max-w-2xl text-[0.95rem] leading-6 text-slate-500">{description}</p>
        </div>
        <span
          className={`w-fit shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${styles.badge}`}
        >
          {statusLabel}
        </span>
      </div>

      <div className={`mt-6 rounded-2xl border p-5 ${styles.detail}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <span
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl font-bold ${styles.icon}`}
            aria-hidden="true"
          >
            {styles.glyph}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-slate-950">{detailTitle}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">{detailDescription}</p>
          </div>
        </div>
        {children}
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-indigo-500 px-6 py-2.5 font-medium text-white shadow-md transition hover:bg-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          type="button"
          onClick={primaryAction.onClick}
          aria-label={primaryAction.ariaLabel}
        >
          {primaryAction.label}
        </button>
        <SecondaryAction action={secondaryAction} />
      </div>
    </section>
  );
}

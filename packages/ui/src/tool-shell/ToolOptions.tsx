import type { ToolOptionDefinition } from "@aio-converter/tool-core";

interface ToolOptionsProps {
  definitions: readonly ToolOptionDefinition[];
  values: Readonly<Record<string, unknown>>;
  errors: Readonly<Record<string, string>>;
  disabled: boolean;
  onChange(key: string, value: unknown): void;
}

export function ToolOptions({ definitions, values, errors, disabled, onChange }: ToolOptionsProps) {
  if (definitions.length === 0) return null;
  return (
    <div className="mt-8" data-testid="tool-options">
      <h2 className="text-[1.125rem] font-semibold text-slate-950">Output settings</h2>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        {definitions.map((option) => {
          const error = errors[option.key];
          const descriptionId = `${option.key}-description`;
          const errorId = `${option.key}-error`;
          const describedBy =
            [option.description ? descriptionId : "", error ? errorId : ""]
              .filter(Boolean)
              .join(" ") || undefined;
          return (
            <div key={option.key}>
              <div className="flex items-center justify-between gap-4">
                <label className="text-[0.95rem] text-slate-600" htmlFor={option.key}>
                  {option.label}
                </label>
                {(option.type === "range" || option.type === "number") && (
                  <output className="text-sm tabular-nums text-slate-500" htmlFor={option.key}>
                    {String(values[option.key] ?? option.defaultValue)}
                    {"suffix" in option && option.suffix ? ` ${option.suffix}` : ""}
                  </output>
                )}
              </div>
              {option.description && (
                <p id={descriptionId} className="mt-1 text-xs text-slate-500">
                  {option.description}
                </p>
              )}
              {option.type === "range" && (
                <input
                  id={option.key}
                  className="mt-2 w-full accent-indigo-500"
                  type="range"
                  min={option.min}
                  max={option.max}
                  step={option.step ?? 1}
                  value={Number(values[option.key] ?? option.defaultValue)}
                  aria-describedby={describedBy}
                  onChange={(event) => onChange(option.key, event.currentTarget.valueAsNumber)}
                  disabled={disabled}
                />
              )}
              {option.type === "number" && (
                <input
                  id={option.key}
                  className="form-control mt-2 w-full rounded-lg border border-slate-200 p-2.5 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  type="number"
                  min={option.min}
                  max={option.max}
                  step={option.step ?? 1}
                  value={Number(values[option.key] ?? option.defaultValue)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={describedBy}
                  onChange={(event) => onChange(option.key, event.currentTarget.valueAsNumber)}
                  disabled={disabled}
                />
              )}
              {option.type === "color" && (
                <input
                  id={option.key}
                  className="mt-2 h-11 w-full max-w-[5rem] cursor-pointer rounded-lg border border-slate-200 p-1"
                  type="color"
                  value={String(values[option.key] ?? option.defaultValue)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={describedBy}
                  onChange={(event) => onChange(option.key, event.currentTarget.value)}
                  disabled={disabled}
                />
              )}
              {option.type === "boolean" && (
                <input
                  id={option.key}
                  className="mt-2 h-5 w-5 accent-indigo-500"
                  type="checkbox"
                  checked={Boolean(values[option.key] ?? option.defaultValue)}
                  aria-describedby={describedBy}
                  onChange={(event) => onChange(option.key, event.currentTarget.checked)}
                  disabled={disabled}
                />
              )}
              {option.type === "select" && (
                <div className="relative mt-2">
                  <select
                    id={option.key}
                    className="w-full appearance-none rounded-lg border border-slate-200 bg-white p-2.5 pr-8 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    value={String(values[option.key] ?? option.defaultValue)}
                    aria-invalid={Boolean(error)}
                    aria-describedby={describedBy}
                    onChange={(event) => onChange(option.key, event.currentTarget.value)}
                    disabled={disabled}
                  >
                    {option.choices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M2.5 4.5L6 8L9.5 4.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
              )}
              {error && (
                <p id={errorId} className="mt-2 text-sm text-red-600">
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

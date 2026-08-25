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
    <fieldset
      className="mt-6 space-y-5 rounded-2xl border border-slate-200 p-5"
      disabled={disabled}
    >
      <legend className="px-2 font-semibold text-slate-950">Options</legend>
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
              <label className="font-medium text-slate-900" htmlFor={option.key}>
                {option.label}
              </label>
              {(option.type === "range" || option.type === "number") && (
                <output className="text-sm tabular-nums text-slate-600" htmlFor={option.key}>
                  {String(values[option.key] ?? option.defaultValue)}
                  {"suffix" in option && option.suffix ? ` ${option.suffix}` : ""}
                </output>
              )}
            </div>
            {option.description && (
              <p id={descriptionId} className="mt-1 text-sm text-slate-600">
                {option.description}
              </p>
            )}
            {option.type === "range" && (
              <input
                id={option.key}
                className="mt-3 w-full accent-sky-600"
                type="range"
                min={option.min}
                max={option.max}
                step={option.step ?? 1}
                value={Number(values[option.key] ?? option.defaultValue)}
                aria-describedby={describedBy}
                onChange={(event) => onChange(option.key, event.currentTarget.valueAsNumber)}
              />
            )}
            {option.type === "number" && (
              <input
                id={option.key}
                className="form-control mt-3"
                type="number"
                min={option.min}
                max={option.max}
                step={option.step ?? 1}
                value={Number(values[option.key] ?? option.defaultValue)}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy}
                onChange={(event) => onChange(option.key, event.currentTarget.valueAsNumber)}
              />
            )}
            {option.type === "color" && (
              <input
                id={option.key}
                className="mt-3 h-11 w-20 cursor-pointer rounded-lg border border-slate-300 p-1"
                type="color"
                value={String(values[option.key] ?? option.defaultValue)}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy}
                onChange={(event) => onChange(option.key, event.currentTarget.value)}
              />
            )}
            {option.type === "boolean" && (
              <input
                id={option.key}
                className="mt-3 h-5 w-5 accent-sky-600"
                type="checkbox"
                checked={Boolean(values[option.key] ?? option.defaultValue)}
                aria-describedby={describedBy}
                onChange={(event) => onChange(option.key, event.currentTarget.checked)}
              />
            )}
            {option.type === "select" && (
              <select
                id={option.key}
                className="form-control mt-3"
                value={String(values[option.key] ?? option.defaultValue)}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy}
                onChange={(event) => onChange(option.key, event.currentTarget.value)}
              >
                {option.choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            )}
            {error && (
              <p id={errorId} className="mt-2 text-sm text-red-700">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

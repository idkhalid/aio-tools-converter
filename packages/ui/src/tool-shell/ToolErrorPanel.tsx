import type { ToolError } from "@aio-converter/tool-core";

export function ToolErrorPanel({ error, onRetry }: { error: ToolError; onRetry(): void }) {
  return (
    <section
      ref={(node) => node?.focus()}
      tabIndex={-1}
      className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 outline-none"
      role="alert"
    >
      <h2 className="font-semibold text-red-950">We could not finish this job</h2>
      <p className="mt-2 text-sm text-red-800">{error.message}</p>
      {error.recoverable && (
        <button className="secondary-button mt-4" type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </section>
  );
}

import type { ExecutionMode } from "@aio-converter/tool-core";

const copy: Record<ExecutionMode, { label: string; description: string }> = {
  LOCAL_ONLY: {
    label: "Processed on your device",
    description: "Your files never leave this browser.",
  },
  SERVER_EPHEMERAL: {
    label: "Temporary server processing",
    description: "Files are sent over HTTPS, processed temporarily, then deleted.",
  },
  REMOTE_FETCH: {
    label: "Remote URL processing",
    description: "The submitted URL is fetched by the processing server.",
  },
};

export function PrivacyBadge({ mode }: { mode: ExecutionMode }) {
  const content = copy[mode];
  return (
    <div className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
      <span aria-hidden="true" className="mt-0.5 text-lg">
        &#128274;
      </span>
      <div>
        <p className="font-semibold">{content.label}</p>
        <p className="mt-1 text-sm text-emerald-800">{content.description}</p>
      </div>
    </div>
  );
}

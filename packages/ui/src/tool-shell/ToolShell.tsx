import {
  ToolError,
  toToolError,
  validateFiles,
  validateOptions,
  type JobExecutor,
  type ToolDefinition,
} from "@aio-converter/tool-core";
import { useEffect, useReducer, useRef } from "react";
import { DropZone } from "./DropZone";
import { FileQueue } from "./FileQueue";
import { PrivacyBadge } from "./PrivacyBadge";
import { ProgressPanel } from "./ProgressPanel";
import { ResultPanel } from "./ResultPanel";
import { ToolErrorPanel } from "./ToolErrorPanel";
import { ToolOptions } from "./ToolOptions";
import { createInitialToolShellState, toolShellReducer } from "./state";

export interface ToolShellProps {
  tool: ToolDefinition;
  executor: JobExecutor;
  archiveExecutor?: JobExecutor;
}

export function ToolShell({ tool, executor, archiveExecutor }: ToolShellProps) {
  const [state, dispatch] = useReducer(toolShellReducer, tool, createInitialToolShellState);
  const abortController = useRef<AbortController | null>(null);
  const runInFlight = useRef(false);
  const runSequence = useRef(0);
  const validationSequence = useRef(0);

  useEffect(() => () => abortController.current?.abort(), []);

  const setFiles = (files: readonly File[]): void => {
    const sequence = ++validationSequence.current;
    dispatch({ type: "files-set", files });
    if (files.length === 0) {
      dispatch({ type: "files-validated", issues: [] });
      return;
    }
    void validateFiles(tool, files).then((issues) => {
      if (sequence === validationSequence.current) {
        dispatch({ type: "files-validated", issues });
      }
    });
  };

  const addFiles = (incoming: readonly File[]): void => {
    const next = tool.maxFiles === 1 ? incoming.slice(0, 1) : [...state.files, ...incoming];
    setFiles(next);
  };

  const updateOption = (key: string, value: unknown): void => {
    const next = { ...state.options, [key]: value };
    const validated = validateOptions(tool.options, next);
    dispatch({ type: "options-set", options: validated.values, errors: validated.errors });
  };

  const process = async (): Promise<void> => {
    if (runInFlight.current) return;
    runInFlight.current = true;

    const runId = ++runSequence.current;
    const controller = new AbortController();
    abortController.current = controller;
    dispatch({ type: "started", runId });
    try {
      const optionResult = validateOptions(tool.options, state.options);
      dispatch({ type: "options-set", options: optionResult.values, errors: optionResult.errors });
      const fileIssues = await validateFiles(tool, state.files);
      dispatch({ type: "files-validated", issues: fileIssues });
      if (controller.signal.aborted) throw new ToolError("CANCELED", "Processing was canceled.");
      if (fileIssues.length > 0 || Object.keys(optionResult.errors).length > 0) {
        dispatch({ type: "validation-rejected", runId });
        return;
      }

      const outputs = await executor.execute(
        { files: state.files, options: optionResult.values },
        {
          signal: controller.signal,
          reportProgress(progress) {
            dispatch({ type: "progress", runId, progress });
          },
        },
      );
      if (outputs.length === 0) {
        throw new ToolError("PROCESSING_FAILED", "The processor did not return a file.");
      }
      dispatch({ type: "succeeded", runId, outputs });
    } catch (error: unknown) {
      const toolError = toToolError(error);
      if (toolError.code === "CANCELED") dispatch({ type: "canceled", runId });
      else dispatch({ type: "failed", runId, error: toolError });
    } finally {
      runInFlight.current = false;
      if (abortController.current === controller) abortController.current = null;
    }
  };

  const cancel = (): void => {
    if (state.runId === null) return;
    dispatch({ type: "cancel-requested", runId: state.runId });
    abortController.current?.abort();
  };

  const busy = state.phase === "processing" || state.phase === "canceling";
  const canProcess =
    !busy &&
    !state.validationPending &&
    state.files.length >= tool.minFiles &&
    state.files.length <= tool.maxFiles &&
    state.fileIssues.length === 0 &&
    Object.keys(state.optionErrors).length === 0;

  return (
    <div className="mx-auto w-full max-w-[800px]" data-tool-id={tool.id}>
      <div className="flex justify-center mb-8">
        <PrivacyBadge mode={tool.execution} />
      </div>

      {state.files.length === 0 && !busy && (
        <DropZone
          accepts={tool.accepts}
          multiple={tool.maxFiles > 1}
          disabled={busy}
          onFiles={addFiles}
          onPickerOpen={() => dispatch({ type: "picker-opened" })}
          onPickerClosed={() => dispatch({ type: "picker-closed" })}
        />
      )}

      {!busy && state.phase !== "success" && state.phase !== "error" && (
        <FileQueue
          files={state.files}
          issues={state.fileIssues}
          disabled={busy}
          reorderable={tool.processor === "pdf-merge"}
          accepts={tool.accepts}
          multiple={tool.maxFiles > 1}
          onFiles={addFiles}
          onRemove={(index) => setFiles(state.files.filter((_, candidate) => candidate !== index))}
          onMove={(index, direction) => {
            const destination = index + direction;
            if (destination < 0 || destination >= state.files.length) return;
            const next = [...state.files];
            const current = next[index];
            const other = next[destination];
            if (!current || !other) return;
            next[index] = other;
            next[destination] = current;
            setFiles(next);
          }}
        />
      )}
      <ToolOptions
        definitions={tool.options}
        values={state.options}
        errors={state.optionErrors}
        disabled={busy}
        onChange={updateOption}
      />
      {!busy && ["idle", "selecting", "ready"].includes(state.phase) && state.files.length > 0 && (
        <button
          className="mt-8 w-full rounded-[1rem] bg-indigo-500 py-4 text-[1.1rem] font-medium text-white shadow-md transition-colors hover:bg-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50"
          type="button"
          disabled={!canProcess}
          onClick={() => void process()}
        >
          {tool.processor === "pdf-merge"
            ? "Merge PDFs"
            : `Convert to ${tool.options.find((o) => o.key === "format")?.defaultValue || tool.id.split("-to-")[1]?.toUpperCase() || "files"}`}
        </button>
      )}
      {busy && (
        <ProgressPanel
          progress={state.progress}
          canceling={state.phase === "canceling"}
          files={state.files}
          onCancel={cancel}
        />
      )}
      {state.phase === "success" && (
        <ResultPanel
          outputs={state.outputs}
          {...(archiveExecutor ? { archiveExecutor } : {})}
          {...(state.files[0] ? { archiveSourceName: state.files[0].name } : {})}
          onReset={() => dispatch({ type: "reset", tool })}
        />
      )}
      {state.phase === "error" && state.error && (
        <ToolErrorPanel error={state.error} files={state.files} onRetry={() => void process()} />
      )}
    </div>
  );
}

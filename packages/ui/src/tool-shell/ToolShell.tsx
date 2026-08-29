import { dedupeFilenames, deriveOutputFilename } from "@aio-converter/shared";
import {
  ToolError,
  toToolError,
  validateFiles,
  validateOptions,
  type JobExecutor,
  type ProcessOutput,
  type ToolDefinition,
} from "@aio-converter/tool-core";
import { useEffect, useReducer, useRef } from "react";
import { DropZone } from "./DropZone";
import { EdgeStatePanel } from "./EdgeStatePanel";
import { FileQueue } from "./FileQueue";
import { MobileActionBar } from "./MobileActionBar";
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

function inferFailedBatchFiles(
  tool: ToolDefinition,
  files: readonly File[],
  outputs: readonly ProcessOutput[],
): readonly File[] {
  const preset = tool.processorPreset;
  if (
    preset?.kind !== "image-convert" ||
    files.length <= 1 ||
    outputs.length === 0 ||
    outputs.length >= files.length
  ) {
    return [];
  }

  const expectedNames = dedupeFilenames(
    files.map((file) => deriveOutputFilename(file.name, preset.outputExtension)),
  );
  const outputNames = new Set(outputs.map((output) => output.name));
  const unmatched = files.filter((_, index) => {
    const expectedName = expectedNames[index];
    return expectedName ? !outputNames.has(expectedName) : true;
  });
  return unmatched.length === files.length - outputs.length
    ? unmatched
    : files.slice(outputs.length);
}

export function ToolShell({ tool, executor, archiveExecutor }: ToolShellProps) {
  const [state, dispatch] = useReducer(toolShellReducer, tool, createInitialToolShellState);
  const abortController = useRef<AbortController | null>(null);
  const runInFlight = useRef(false);
  const runSequence = useRef(0);
  const validationSequence = useRef(0);
  const replacementInput = useRef<HTMLInputElement>(null);

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

  const processFiles = async (
    filesToProcess: readonly File[] = state.files,
    retainedOutputs: readonly ProcessOutput[] = [],
    retainedFailedFiles: readonly File[] = [],
  ): Promise<void> => {
    if (runInFlight.current) return;
    runInFlight.current = true;

    const runId = ++runSequence.current;
    const controller = new AbortController();
    abortController.current = controller;
    dispatch({ type: "started", runId });
    try {
      const optionResult = validateOptions(tool.options, state.options);
      dispatch({ type: "options-set", options: optionResult.values, errors: optionResult.errors });
      const fileIssues = await validateFiles(tool, filesToProcess);
      dispatch({ type: "files-validated", issues: fileIssues });
      if (controller.signal.aborted) throw new ToolError("CANCELED", "Processing was canceled.");
      if (fileIssues.length > 0 || Object.keys(optionResult.errors).length > 0) {
        dispatch({ type: "validation-rejected", runId });
        return;
      }

      const outputs = await executor.execute(
        { files: filesToProcess, options: optionResult.values },
        {
          signal: controller.signal,
          reportProgress(progress) {
            dispatch({ type: "progress", runId, progress });
          },
        },
      );
      if (outputs.length === 0) {
        if (retainedOutputs.length > 0) {
          dispatch({
            type: "partial-failed",
            runId,
            outputs: retainedOutputs,
            failedFiles: [...retainedFailedFiles, ...filesToProcess],
            error: new ToolError("PROCESSING_FAILED", "No output was created for this file."),
          });
        } else {
          dispatch({ type: "empty-result", runId });
        }
        return;
      }
      const combinedOutputs = [...retainedOutputs, ...outputs];
      const failedFiles = [
        ...retainedFailedFiles,
        ...inferFailedBatchFiles(tool, filesToProcess, outputs),
      ];
      if (failedFiles.length > 0) {
        dispatch({ type: "partially-succeeded", runId, outputs: combinedOutputs, failedFiles });
      } else {
        dispatch({ type: "succeeded", runId, outputs: combinedOutputs });
      }
    } catch (error: unknown) {
      const toolError = toToolError(error);
      if (toolError.code === "CANCELED") dispatch({ type: "canceled", runId });
      else if (retainedOutputs.length > 0) {
        dispatch({
          type: "partial-failed",
          runId,
          outputs: retainedOutputs,
          failedFiles: [...retainedFailedFiles, ...filesToProcess],
          error: toolError,
        });
      } else dispatch({ type: "failed", runId, error: toolError });
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

  const replaceFile = (index: number, incoming: readonly File[]): void => {
    if (incoming.length === 0) return;
    const next = [...state.files];
    next.splice(index, 1, ...incoming);
    setFiles(next.slice(0, tool.maxFiles));
  };

  const chooseAnotherFile = (): void => replacementInput.current?.click();

  const busy = state.phase === "processing" || state.phase === "canceling";
  const canProcess =
    !busy &&
    !state.validationPending &&
    state.files.length >= tool.minFiles &&
    state.files.length <= tool.maxFiles &&
    state.fileIssues.length === 0 &&
    Object.keys(state.optionErrors).length === 0;
  const readyForAction =
    ["idle", "selecting", "ready"].includes(state.phase) && canProcess && state.files.length > 0;
  const hasStickyAction =
    readyForAction || state.phase === "success" || state.phase === "partial-success";
  const processLabel =
    tool.processor === "pdf-merge"
      ? "Merge PDFs"
      : `Convert to ${tool.options.find((option) => option.key === "format")?.defaultValue || tool.id.split("-to-")[1]?.toUpperCase() || "files"}`;

  const processButton = (compact = false, label = processLabel) => (
    <button
      className={
        compact
          ? "rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white shadow-md transition-colors hover:bg-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50"
          : "w-full rounded-[1rem] bg-indigo-500 py-4 text-[1.1rem] font-medium text-white shadow-md transition-colors hover:bg-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50"
      }
      type="button"
      disabled={!canProcess}
      onClick={() => void processFiles()}
      aria-label="Process files"
    >
      {label}
    </button>
  );

  return (
    <div
      className={`mx-auto w-full max-w-[800px] ${
        hasStickyAction ? "pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:pb-0" : ""
      }`}
      data-tool-id={tool.id}
    >
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

      {!busy &&
        state.phase !== "success" &&
        state.phase !== "partial-success" &&
        state.phase !== "error" && (
          <FileQueue
            files={state.files}
            issues={state.fileIssues}
            disabled={busy}
            reorderable={tool.processor === "pdf-merge"}
            accepts={tool.accepts}
            multiple={tool.maxFiles > 1}
            maxInputBytes={tool.maxInputBytes}
            maxTotalBytes={tool.maxTotalBytes ?? tool.maxInputBytes * tool.maxFiles}
            onFiles={addFiles}
            onReplace={replaceFile}
            onRemove={(index) =>
              setFiles(state.files.filter((_, candidate) => candidate !== index))
            }
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
        <>
          <div className="mt-8 hidden sm:block">{processButton()}</div>
          {readyForAction && (
            <MobileActionBar
              title={`${state.files.length} file${state.files.length !== 1 ? "s" : ""} selected`}
              description={tool.processor === "pdf-merge" ? "Ready to merge" : "Ready to convert"}
            >
              {processButton(true, "Process files")}
            </MobileActionBar>
          )}
        </>
      )}
      {busy && (
        <ProgressPanel
          progress={state.progress}
          canceling={state.phase === "canceling"}
          files={state.files}
          onCancel={cancel}
        />
      )}
      {(state.phase === "success" || state.phase === "partial-success") && (
        <ResultPanel
          outputs={state.outputs}
          failedFiles={state.failedFiles}
          retryError={state.error?.message ?? null}
          onRetryFile={(file) => {
            const retainedFailedFiles = state.failedFiles.filter((candidate) => candidate !== file);
            void processFiles([file], state.outputs, retainedFailedFiles);
          }}
          {...(archiveExecutor ? { archiveExecutor } : {})}
          {...(state.files[0] ? { archiveSourceName: state.files[0].name } : {})}
          onReset={() => dispatch({ type: "reset", tool })}
        />
      )}
      {state.phase === "canceled" && (
        <EdgeStatePanel
          tone="neutral"
          statusLabel="Cancelled"
          title="Conversion cancelled"
          description="No files were changed. You can restart the conversion when you're ready."
          detailTitle="Process stopped"
          detailDescription="Your selected files are still available in the queue."
          primaryAction={{
            label: "Start again",
            ariaLabel: "Process files",
            onClick: () => void processFiles(),
          }}
          secondaryAction={{ label: "Remove files", onClick: () => setFiles([]) }}
        />
      )}
      {state.phase === "empty" && (
        <EdgeStatePanel
          tone="warning"
          statusLabel="No output"
          title="No output was created"
          description="The conversion finished, but no downloadable file was generated. Check the source file and try again."
          detailTitle="Nothing to download"
          detailDescription="The input may be corrupt, empty, or unsupported by this tool."
          primaryAction={{ label: "Try again", onClick: () => void processFiles() }}
          secondaryAction={{ label: "Upload another file", onClick: chooseAnotherFile }}
        />
      )}
      {state.phase === "error" && state.error && (
        <ToolErrorPanel
          error={state.error}
          files={state.files}
          tool={tool}
          onRetry={() => void processFiles()}
          onChooseAnother={chooseAnotherFile}
          onRemoveFiles={() => setFiles([])}
        />
      )}
      <input
        ref={replacementInput}
        className="sr-only"
        type="file"
        tabIndex={-1}
        accept={tool.accepts.join(",")}
        multiple={tool.maxFiles > 1}
        onChange={(event) => {
          if (event.currentTarget.files) setFiles([...event.currentTarget.files]);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

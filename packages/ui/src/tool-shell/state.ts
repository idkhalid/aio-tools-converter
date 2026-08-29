import {
  defaultOptions,
  type FileValidationIssue,
  type ProcessOutput,
  type ProcessProgress,
  type ToolDefinition,
  type ToolError,
} from "@aio-converter/tool-core";

export type ToolShellPhase =
  | "idle"
  | "selecting"
  | "ready"
  | "processing"
  | "canceling"
  | "canceled"
  | "success"
  | "partial-success"
  | "empty"
  | "error";

export interface ToolShellState {
  phase: ToolShellPhase;
  files: readonly File[];
  options: Readonly<Record<string, unknown>>;
  optionErrors: Readonly<Record<string, string>>;
  fileIssues: readonly FileValidationIssue[];
  validationPending: boolean;
  progress: ProcessProgress | null;
  outputs: readonly ProcessOutput[];
  failedFiles: readonly File[];
  error: ToolError | null;
  runId: number | null;
}

export type ToolShellEvent =
  | { type: "picker-opened" }
  | { type: "picker-closed" }
  | { type: "files-set"; files: readonly File[] }
  | { type: "files-validated"; issues: readonly FileValidationIssue[] }
  | {
      type: "options-set";
      options: Readonly<Record<string, unknown>>;
      errors: Readonly<Record<string, string>>;
    }
  | { type: "started"; runId: number }
  | { type: "validation-rejected"; runId: number }
  | { type: "progress"; runId: number; progress: ProcessProgress }
  | { type: "succeeded"; runId: number; outputs: readonly ProcessOutput[] }
  | {
      type: "partially-succeeded";
      runId: number;
      outputs: readonly ProcessOutput[];
      failedFiles: readonly File[];
    }
  | {
      type: "partial-failed";
      runId: number;
      outputs: readonly ProcessOutput[];
      failedFiles: readonly File[];
      error: ToolError;
    }
  | { type: "empty-result"; runId: number }
  | { type: "failed"; runId: number; error: ToolError }
  | { type: "cancel-requested"; runId: number }
  | { type: "canceled"; runId: number }
  | { type: "reset"; tool: ToolDefinition };

export function createInitialToolShellState(tool: ToolDefinition): ToolShellState {
  return {
    phase: "idle",
    files: [],
    options: defaultOptions(tool.options),
    optionErrors: {},
    fileIssues: [],
    validationPending: false,
    progress: null,
    outputs: [],
    failedFiles: [],
    error: null,
    runId: null,
  };
}

function phaseWithFiles(files: readonly File[]): "idle" | "ready" {
  return files.length === 0 ? "idle" : "ready";
}

export function toolShellReducer(state: ToolShellState, event: ToolShellEvent): ToolShellState {
  switch (event.type) {
    case "picker-opened":
      return { ...state, phase: "selecting" };
    case "picker-closed":
      return state.phase === "selecting" ? { ...state, phase: phaseWithFiles(state.files) } : state;
    case "files-set":
      return {
        ...state,
        phase: phaseWithFiles(event.files),
        files: event.files,
        fileIssues: [],
        validationPending: event.files.length > 0,
        outputs: [],
        failedFiles: [],
        error: null,
        progress: null,
        runId: null,
      };
    case "files-validated":
      return { ...state, fileIssues: event.issues, validationPending: false };
    case "options-set":
      return {
        ...state,
        options: event.options,
        optionErrors: event.errors,
        outputs: ["success", "partial-success", "empty"].includes(state.phase) ? [] : state.outputs,
        failedFiles: state.phase === "partial-success" ? [] : state.failedFiles,
        phase: ["success", "partial-success", "empty"].includes(state.phase)
          ? phaseWithFiles(state.files)
          : state.phase,
      };
    case "started":
      return {
        ...state,
        phase: "processing",
        runId: event.runId,
        progress: { stage: "validating", progress: null, message: "Validating files" },
        outputs: [],
        failedFiles: [],
        error: null,
      };
    case "validation-rejected":
      return event.runId === state.runId
        ? {
            ...state,
            phase: phaseWithFiles(state.files),
            progress: null,
            runId: null,
          }
        : state;
    case "progress":
      return event.runId === state.runId && state.phase === "processing"
        ? { ...state, progress: event.progress }
        : state;
    case "succeeded":
      return event.runId === state.runId
        ? {
            ...state,
            phase: "success",
            progress: { stage: "complete", progress: 1, message: "Processing complete" },
            outputs: event.outputs,
            failedFiles: [],
            error: null,
            runId: null,
          }
        : state;
    case "partially-succeeded":
      return event.runId === state.runId
        ? {
            ...state,
            phase: "partial-success",
            progress: { stage: "complete", progress: 1, message: "Processing complete" },
            outputs: event.outputs,
            failedFiles: event.failedFiles,
            error: null,
            runId: null,
          }
        : state;
    case "partial-failed":
      return event.runId === state.runId
        ? {
            ...state,
            phase: "partial-success",
            progress: null,
            outputs: event.outputs,
            failedFiles: event.failedFiles,
            error: event.error,
            runId: null,
          }
        : state;
    case "empty-result":
      return event.runId === state.runId
        ? {
            ...state,
            phase: "empty",
            progress: { stage: "complete", progress: 1, message: "Processing complete" },
            outputs: [],
            failedFiles: [],
            error: null,
            runId: null,
          }
        : state;
    case "failed":
      return event.runId === state.runId
        ? {
            ...state,
            phase: "error",
            progress: null,
            outputs: [],
            failedFiles: [],
            error: event.error,
            runId: null,
          }
        : state;
    case "cancel-requested":
      return event.runId === state.runId ? { ...state, phase: "canceling" } : state;
    case "canceled":
      return event.runId === state.runId
        ? {
            ...state,
            phase: "canceled",
            progress: null,
            outputs: [],
            failedFiles: [],
            error: null,
            runId: null,
          }
        : state;
    case "reset":
      return createInitialToolShellState(event.tool);
  }
}

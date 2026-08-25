import {
  defaultOptions,
  type FileValidationIssue,
  type ProcessOutput,
  type ProcessProgress,
  type ToolDefinition,
  type ToolError,
} from "@aio-converter/tool-core";

export type ToolShellPhase =
  "idle" | "selecting" | "ready" | "processing" | "canceling" | "success" | "error";

export interface ToolShellState {
  phase: ToolShellPhase;
  files: readonly File[];
  options: Readonly<Record<string, unknown>>;
  optionErrors: Readonly<Record<string, string>>;
  fileIssues: readonly FileValidationIssue[];
  validationPending: boolean;
  progress: ProcessProgress | null;
  outputs: readonly ProcessOutput[];
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
        outputs: state.phase === "success" ? [] : state.outputs,
        phase: state.phase === "success" ? phaseWithFiles(state.files) : state.phase,
      };
    case "started":
      return {
        ...state,
        phase: "processing",
        runId: event.runId,
        progress: { stage: "validating", progress: null, message: "Validating files" },
        outputs: [],
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
            error: event.error,
            runId: null,
          }
        : state;
    case "cancel-requested":
      return event.runId === state.runId ? { ...state, phase: "canceling" } : state;
    case "canceled":
      return event.runId === state.runId || state.phase === "canceling"
        ? {
            ...state,
            phase: phaseWithFiles(state.files),
            progress: null,
            error: null,
            runId: null,
          }
        : state;
    case "reset":
      return createInitialToolShellState(event.tool);
  }
}

export type ToolErrorCode =
  | "FILE_COUNT"
  | "FILE_TOO_LARGE"
  | "TOTAL_TOO_LARGE"
  | "FILE_TYPE"
  | "FILE_SIGNATURE"
  | "OPTION_INVALID"
  | "BROWSER_UNSUPPORTED"
  | "ENCRYPTED_PDF"
  | "PROCESSING_FAILED"
  | "NETWORK_ERROR"
  | "SERVER_REJECTED"
  | "TIMEOUT"
  | "CANCELED";

export interface SerializedToolError {
  code: ToolErrorCode;
  message: string;
  recoverable: boolean;
}

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly recoverable: boolean;

  constructor(code: ToolErrorCode, message: string, recoverable = true) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.recoverable = recoverable;
  }

  serialize(): SerializedToolError {
    return { code: this.code, message: this.message, recoverable: this.recoverable };
  }
}

export function canceledError(): ToolError {
  return new ToolError("CANCELED", "Processing was canceled.");
}

export function toToolError(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  if (error instanceof DOMException && error.name === "AbortError") return canceledError();
  return new ToolError(
    "PROCESSING_FAILED",
    "The file could not be processed. Check the file and try again.",
  );
}

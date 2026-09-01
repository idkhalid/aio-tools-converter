import type {
  ProcessProgress,
  ProcessOutput,
  ProcessorPreset,
  SerializedToolError,
} from "@aio-converter/tool-core";

export interface BufferFile {
  name: string;
  mimeType: string;
  lastModified: number;
  data: Uint8Array;
}

export interface BufferProcessorInput {
  files: readonly BufferFile[];
  options: Readonly<Record<string, unknown>>;
  preset?: ProcessorPreset;
}

export interface BufferProcessOutput {
  name: string;
  mimeType: string;
  data: Uint8Array;
  metadata?: ProcessOutput["metadata"];
}

export interface BufferProcessContext {
  signal: AbortSignal;
  reportProgress(update: ProcessProgress): void;
}

export interface BufferProcessor {
  process(
    input: BufferProcessorInput,
    context: BufferProcessContext,
  ): Promise<readonly BufferProcessOutput[]>;
}

export type WorkerRequest =
  | {
      type: "init";
      jobId: string;
      options: Readonly<Record<string, unknown>>;
      preset?: ProcessorPreset;
    }
  | {
      type: "file";
      jobId: string;
      name: string;
      mimeType: string;
      lastModified: number;
      data: ArrayBuffer;
    }
  | { type: "run"; jobId: string }
  | { type: "cancel"; jobId: string };

export interface WorkerOutput {
  name: string;
  mimeType: string;
  size: number;
  data: ArrayBuffer;
  metadata?: ProcessOutput["metadata"];
}

export type WorkerResponse =
  | { type: "progress"; jobId: string; update: ProcessProgress }
  | { type: "result"; jobId: string; outputs: readonly WorkerOutput[] }
  | { type: "error"; jobId: string; error: SerializedToolError };

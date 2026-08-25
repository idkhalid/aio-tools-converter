export type ToolCategory = "image" | "pdf" | "document" | "gif" | "audio" | "video" | "downloader";

export type ExecutionMode = "LOCAL_ONLY" | "SERVER_EPHEMERAL" | "REMOTE_FETCH";

export type NativeImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface ImageConvertProcessorPreset {
  kind: "image-convert";
  inputMimeType: NativeImageMimeType;
  outputMimeType: NativeImageMimeType;
  outputExtension: "jpg" | "png" | "webp";
  flattenTransparency: boolean;
}

export type ProcessorPreset = ImageConvertProcessorPreset;

interface OptionBase {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
}

export interface RangeOptionDefinition extends OptionBase {
  type: "range";
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
}

export interface NumberOptionDefinition extends OptionBase {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
  defaultValue: number;
  suffix?: string;
}

export interface ColorOptionDefinition extends OptionBase {
  type: "color";
  defaultValue: string;
}

export interface BooleanOptionDefinition extends OptionBase {
  type: "boolean";
  defaultValue: boolean;
}

export interface SelectOptionDefinition extends OptionBase {
  type: "select";
  choices: readonly { value: string; label: string }[];
  defaultValue: string;
}

export type ToolOptionDefinition =
  | RangeOptionDefinition
  | NumberOptionDefinition
  | ColorOptionDefinition
  | BooleanOptionDefinition
  | SelectOptionDefinition;

export interface ToolDefinition {
  id: string;
  slug: string;
  category: ToolCategory;
  title: string;
  shortDescription: string;
  execution: ExecutionMode;
  processor: string;
  processorPreset?: ProcessorPreset;
  accepts: readonly string[];
  outputs: readonly string[];
  minFiles: number;
  maxFiles: number;
  /** Maximum bytes for an individual input. */
  maxInputBytes: number;
  /** Maximum aggregate bytes; defaults to maxInputBytes * maxFiles. */
  maxTotalBytes?: number;
  timeoutMs?: number;
  options: readonly ToolOptionDefinition[];
  seo: {
    title: string;
    description: string;
    canonicalPath: string;
  };
  status: "active" | "beta" | "coming-soon";
}

export interface ProcessInput {
  files: readonly File[];
  options: Readonly<Record<string, unknown>>;
}

export interface ProcessProgress {
  stage: string;
  progress: number | null;
  message?: string;
}

export interface ProcessContext {
  signal: AbortSignal;
  reportProgress(update: ProcessProgress): void;
}

export interface ProcessOutput {
  name: string;
  mimeType: string;
  size: number;
  blob: Blob;
}

export interface JobExecutor {
  execute(input: ProcessInput, context: ProcessContext): Promise<readonly ProcessOutput[]>;
}

export interface ProcessorManifestEntry {
  id: string;
  target: "browser" | "server";
}

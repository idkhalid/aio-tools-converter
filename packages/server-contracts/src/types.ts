export type ServerJobStatus =
  | "accepting"
  | "queued"
  | "running"
  | "canceling"
  | "succeeded"
  | "failed"
  | "canceled"
  | "timed_out";

export interface ServerProgress {
  stage: string;
  progress: number | null;
  message?: string;
}

export interface ServerOutputInfo {
  available: boolean;
  name?: string;
  mimeType?: string;
  size?: number;
}

export interface ServerPublicError {
  code: string;
  message: string;
}

export interface ServerJobSnapshot {
  jobId: string;
  toolId: string;
  status: ServerJobStatus;
  progress: ServerProgress;
  output?: ServerOutputInfo;
  error?: ServerPublicError;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  version: number;
}

export interface CreateJobResponse {
  jobId: string;
  toolId: string;
  status: ServerJobStatus;
  statusUrl: string;
  eventsUrl: string;
  outputUrl: string;
}

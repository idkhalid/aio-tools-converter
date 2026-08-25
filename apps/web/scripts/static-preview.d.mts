import type { Server } from "node:http";

export interface StaticPreviewOptions {
  root: string;
  host: string;
  port: number;
}

export function createStaticPreview(options: StaticPreviewOptions): Promise<Server>;

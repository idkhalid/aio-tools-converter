import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerJobExecutor } from "./executor";
import type { CreateJobResponse, ServerJobSnapshot } from "./types";

const created: CreateJobResponse = {
  jobId: "job-1",
  toolId: "docx-to-pdf",
  status: "queued",
  statusUrl: "/v1/jobs/job-1",
  eventsUrl: "/v1/jobs/job-1/events",
  outputUrl: "/v1/jobs/job-1/output",
};

function mockSuccessfulJob(options: { disposition?: string; snapshotName?: string }): void {
  const snapshot: ServerJobSnapshot = {
    jobId: created.jobId,
    toolId: created.toolId,
    status: "succeeded",
    progress: { stage: "completed", progress: 1 },
    output: {
      available: true,
      mimeType: "application/pdf",
      ...(options.snapshotName ? { name: options.snapshotName } : {}),
    },
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:01.000Z",
    version: 2,
  };
  const outputHeaders = new Headers({ "Content-Type": "application/pdf" });
  if (options.disposition) {
    outputHeaders.set("Content-Disposition", options.disposition);
  }

  const fetchMock = vi.fn<typeof fetch>();
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify(created), {
        headers: { "Content-Type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(`data: ${JSON.stringify(snapshot)}\n\n`, {
        headers: { "Content-Type": "text/event-stream" },
      }),
    )
    .mockResolvedValueOnce(new Response("%PDF-1.7", { headers: outputHeaders }));
  vi.stubGlobal("fetch", fetchMock);
}

async function execute(inputName: string): Promise<string | undefined> {
  const executor = new ServerJobExecutor({
    apiBaseURL: "https://api.example.test",
    toolId: "docx-to-pdf",
    timeoutMs: 1_000,
    outputExtension: "pdf",
  });
  const outputs = await executor.execute(
    {
      files: [
        new File(["docx"], inputName, {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      ],
      options: {},
    },
    {
      signal: new AbortController().signal,
      reportProgress() {},
    },
  );
  return outputs[0]?.name;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ServerJobExecutor output filenames", () => {
  it("replaces a generic backend filename with one derived from the original input", async () => {
    mockSuccessfulJob({
      disposition: 'attachment; filename="converted.pdf"',
      snapshotName: "converted.pdf",
    });

    await expect(execute("Surat Edaran 17 Agustus 2025.docx")).resolves.toBe(
      "Surat Edaran 17 Agustus 2025.pdf",
    );
  });

  it("honors a meaningful safe Content-Disposition filename", async () => {
    mockSuccessfulJob({
      disposition: "attachment; filename*=UTF-8''Laporan%20Final.pdf",
      snapshotName: "converted.pdf",
    });

    await expect(execute("Surat Edaran.docx")).resolves.toBe("Laporan Final.pdf");
  });

  it("derives the filename when backend filename metadata is missing", async () => {
    mockSuccessfulJob({});

    await expect(execute("dokumen.revisi.final.docx")).resolves.toBe("dokumen.revisi.final.pdf");
  });

  it("rejects a backend filename with an unexpected extension", async () => {
    mockSuccessfulJob({
      disposition: 'attachment; filename="invoice.exe"',
      snapshotName: "result.exe",
    });

    await expect(execute("invoice.docx")).resolves.toBe("invoice.pdf");
  });
});

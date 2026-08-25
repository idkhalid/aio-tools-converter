import type { Download, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";

interface PDFPage {
  getSize(): { width: number; height: number };
}

interface PDFDocument {
  addPage(size: [number, number]): PDFPage;
  getPages(): readonly PDFPage[];
  save(options?: { useObjectStreams?: boolean }): Promise<Uint8Array>;
}

interface PDFLibModule {
  PDFDocument: {
    create(): Promise<PDFDocument>;
    load(bytes: Uint8Array): Promise<PDFDocument>;
  };
}

interface FflateModule {
  zipSync(
    entries: Readonly<Record<string, Uint8Array>>,
    options?: { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 },
  ): Uint8Array;
}

const requireFromBrowserProcessors = createRequire(
  new URL("../../../packages/browser-processors/package.json", import.meta.url),
);
const { PDFDocument } = requireFromBrowserProcessors("pdf-lib") as PDFLibModule;
const { zipSync } = requireFromBrowserProcessors("fflate") as FflateModule;

function crc32(data: Uint8Array): number {
  let checksum = 0xffffffff;
  for (const byte of data) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

export function syntheticPNG(red: number, green: number, blue: number, alpha = 255): Buffer {
  const width = 3;
  const height = 2;
  const rowLength = 1 + width * 4;
  const pixels = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * rowLength;
    pixels[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = alpha;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export async function syntheticPDF(
  pageSizes: readonly (readonly [number, number])[],
): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (const [width, height] of pageSizes) document.addPage([width, height]);
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

export async function inspectPDF(
  bytes: Uint8Array,
): Promise<readonly { width: number; height: number }[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => page.getSize());
}

export function syntheticDOCX(): Buffer {
  const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
  const entries: Readonly<Record<string, Uint8Array>> = {
    "[Content_Types].xml": encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    ),
    "_rels/.rels": encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    ),
    "word/document.xml": encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>AIO Converter synthetic Playwright document</w:t></w:r></w:p>
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`,
    ),
  };
  return Buffer.from(zipSync(entries, { level: 0 }));
}

export async function readDownload(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error("Playwright did not provide a local download path.");
  return readFile(path);
}

export function trackJobRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/v1/jobs")) requests.push(`${request.method()} ${url.pathname}`);
  });
  return requests;
}

export async function attachSyntheticWebM(page: Page): Promise<void> {
  const input = page.getByTestId("drop-zone").locator('input[type="file"]');
  await input.evaluate(async (element) => {
    const fileInput = element as HTMLInputElement;
    if (typeof MediaRecorder === "undefined") {
      throw new Error("Chromium MediaRecorder is unavailable.");
    }
    const mimeType = ["video/webm;codecs=vp8", "video/webm"].find((candidate) =>
      MediaRecorder.isTypeSupported(candidate),
    );
    if (!mimeType) throw new Error("Chromium cannot record a synthetic WebM fixture.");

    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const drawing = canvas.getContext("2d");
    if (!drawing) throw new Error("Canvas 2D is unavailable.");
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 180_000 });
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.addEventListener(
        "error",
        () => reject(new Error("Synthetic WebM recording failed.")),
        {
          once: true,
        },
      );
    });

    recorder.start(100);
    for (let frame = 0; frame < 13; frame += 1) {
      drawing.fillStyle = frame % 2 === 0 ? "#0369a1" : "#16a34a";
      drawing.fillRect(0, 0, canvas.width, canvas.height);
      drawing.fillStyle = "#ffffff";
      drawing.font = "bold 32px sans-serif";
      drawing.fillText(`Frame ${frame + 1}`, 72, 100);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());

    const blob = new Blob(chunks, { type: "video/webm" });
    const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (
      signature[0] !== 0x1a ||
      signature[1] !== 0x45 ||
      signature[2] !== 0xdf ||
      signature[3] !== 0xa3
    ) {
      throw new Error("Synthetic WebM has an invalid EBML signature.");
    }
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "synthetic.webm", { type: "video/webm" }));
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@aio-converter/tool-core";
import { toolDefinitions } from "./definitions";
import { processorManifest } from "./processor-manifest";
import { getRelatedTools } from "./registry";
import { validateRegistry } from "./validation";

describe("tool registry", () => {
  it("validates the Phase 1 registry", () => {
    expect(validateRegistry(toolDefinitions, processorManifest)).toEqual([]);
  });

  it("rejects duplicate ids and LOCAL_ONLY server processors", () => {
    const duplicate = {
      ...toolDefinitions[0],
      slug: "another-slug",
      seo: { ...toolDefinitions[0].seo, canonicalPath: "/image/another-slug" },
      processor: "office-docx-to-pdf",
    } satisfies ToolDefinition;
    const issues = validateRegistry([...toolDefinitions, duplicate], processorManifest);
    expect(issues).toContain(`Duplicate tool id: ${duplicate.id}`);
    expect(issues).toContain(`${duplicate.id}: LOCAL_ONLY cannot use a server processor`);
  });

  it("rejects duplicate slugs and canonical paths", () => {
    const duplicate = {
      ...toolDefinitions[0],
      id: "image.duplicate-route",
    } satisfies ToolDefinition;
    const issues = validateRegistry([...toolDefinitions, duplicate], processorManifest);
    expect(issues).toContain(`Duplicate tool slug: ${duplicate.slug}`);
    expect(issues).toContain(`Duplicate canonical path: ${duplicate.seo.canonicalPath}`);
  });

  it("rejects missing processors, invalid MIME, ranges, and SEO", () => {
    const invalid = {
      ...toolDefinitions[0],
      id: "image.invalid-tool",
      slug: "invalid-tool",
      processor: "missing-processor",
      accepts: ["not-a-mime"],
      minFiles: 3,
      maxFiles: 2,
      seo: {
        title: "",
        description: "",
        canonicalPath: "/image/invalid-tool",
      },
      status: "active",
    } satisfies ToolDefinition;
    const issues = validateRegistry([invalid], processorManifest);
    expect(issues).toContain(`${invalid.id}: processor missing-processor was not found`);
    expect(issues).toContain(`${invalid.id}: invalid MIME type not-a-mime`);
    expect(issues).toContain(`${invalid.id}: minFiles must be between 1 and maxFiles`);
    expect(issues).toContain(`${invalid.id}: routable tools require SEO title and description`);
  });

  it("returns related tools without the current tool", () => {
    const related = getRelatedTools(toolDefinitions[0]);
    expect(related).not.toContainEqual(toolDefinitions[0]);
    expect(related.length).toBeLessThanOrEqual(3);
  });

  it("requires image presets to match the registry MIME contract", () => {
    const { processorPreset, ...definitionWithoutPreset } = toolDefinitions[0];
    const missingPreset = definitionWithoutPreset satisfies ToolDefinition;
    const mismatchedPreset = {
      ...toolDefinitions[0],
      processorPreset: {
        ...toolDefinitions[0].processorPreset,
        outputMimeType: "image/webp",
        outputExtension: "webp",
      },
    } satisfies ToolDefinition;

    expect(processorPreset).toBeDefined();
    expect(validateRegistry([missingPreset], processorManifest)).toContain(
      `${missingPreset.id}: image-convert requires an image processor preset`,
    );
    expect(validateRegistry([mismatchedPreset], processorManifest)).toContain(
      `${mismatchedPreset.id}: image preset output must be listed in outputs`,
    );
  });
});

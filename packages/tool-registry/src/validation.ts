import {
  defaultOptions,
  validateOptions,
  type ProcessorManifestEntry,
  type ToolDefinition,
} from "@aio-converter/tool-core";

const MIME_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class RegistryValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid tool registry:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "RegistryValidationError";
    this.issues = issues;
  }
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function validateRegistry(
  tools: readonly ToolDefinition[],
  processors: readonly ProcessorManifestEntry[],
): readonly string[] {
  const issues: string[] = [];
  const processorById = new Map(processors.map((processor) => [processor.id, processor]));

  for (const duplicate of duplicateValues(tools.map((tool) => tool.id))) {
    issues.push(`Duplicate tool id: ${duplicate}`);
  }
  for (const duplicate of duplicateValues(tools.map((tool) => tool.slug))) {
    issues.push(`Duplicate tool slug: ${duplicate}`);
  }
  for (const duplicate of duplicateValues(tools.map((tool) => tool.seo.canonicalPath))) {
    issues.push(`Duplicate canonical path: ${duplicate}`);
  }

  for (const tool of tools) {
    if (!SLUG_PATTERN.test(tool.slug)) issues.push(`${tool.id}: invalid slug`);
    if (tool.minFiles < 1 || tool.minFiles > tool.maxFiles) {
      issues.push(`${tool.id}: minFiles must be between 1 and maxFiles`);
    }
    if (tool.maxInputBytes <= 0 || (tool.maxTotalBytes ?? 1) <= 0) {
      issues.push(`${tool.id}: input byte limits must be positive`);
    }
    const expectedPath = `/${tool.category}/${tool.slug}`;
    if (tool.seo.canonicalPath !== expectedPath) {
      issues.push(`${tool.id}: canonical path must be ${expectedPath}`);
    }
    if (tool.status !== "coming-soon" && (!tool.seo.title.trim() || !tool.seo.description.trim())) {
      issues.push(`${tool.id}: routable tools require SEO title and description`);
    }
    for (const mime of [...tool.accepts, ...tool.outputs]) {
      if (!MIME_PATTERN.test(mime)) issues.push(`${tool.id}: invalid MIME type ${mime}`);
    }

    const processor = processorById.get(tool.processor);
    if (!processor) {
      issues.push(`${tool.id}: processor ${tool.processor} was not found`);
    } else if (tool.execution === "LOCAL_ONLY" && processor.target !== "browser") {
      issues.push(`${tool.id}: LOCAL_ONLY cannot use a server processor`);
    } else if (tool.execution === "SERVER_EPHEMERAL" && processor.target !== "server") {
      issues.push(`${tool.id}: SERVER_EPHEMERAL must use a server processor`);
    }

    if (tool.processor === "image-convert") {
      const preset = tool.processorPreset;
      if (!preset || preset.kind !== "image-convert") {
        issues.push(`${tool.id}: image-convert requires an image processor preset`);
      } else {
        const inputMimeTypes = preset.inputMimeTypes ?? [preset.inputMimeType];
        for (const inputMimeType of inputMimeTypes) {
          if (!tool.accepts.includes(inputMimeType)) {
            issues.push(`${tool.id}: image preset input must be listed in accepts`);
          }
        }
        if (preset.preserveInputFormat) {
          for (const inputMimeType of inputMimeTypes) {
            if (!tool.outputs.includes(inputMimeType)) {
              issues.push(
                `${tool.id}: preserving image format requires matching output MIME types`,
              );
            }
          }
        }
        if (!tool.outputs.includes(preset.outputMimeType)) {
          issues.push(`${tool.id}: image preset output must be listed in outputs`);
        }
        if (
          (preset.operation ?? "convert") === "convert" &&
          preset.outputMimeType === "image/jpeg" &&
          !preset.flattenTransparency
        ) {
          issues.push(`${tool.id}: JPEG output must flatten transparency`);
        }
      }
    } else if (tool.processorPreset) {
      issues.push(`${tool.id}: processor preset does not match ${tool.processor}`);
    }

    const duplicateOptionKeys = duplicateValues(tool.options.map((option) => option.key));
    for (const key of duplicateOptionKeys) issues.push(`${tool.id}: duplicate option key ${key}`);
    const defaults = validateOptions(tool.options, defaultOptions(tool.options));
    for (const [key, message] of Object.entries(defaults.errors)) {
      issues.push(`${tool.id}: invalid default for ${key}: ${message}`);
    }
  }

  return issues;
}

export function assertValidRegistry(
  tools: readonly ToolDefinition[],
  processors: readonly ProcessorManifestEntry[],
): void {
  const issues = validateRegistry(tools, processors);
  if (issues.length > 0) throw new RegistryValidationError(issues);
}

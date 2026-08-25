import type { ToolCategory, ToolDefinition } from "@aio-converter/tool-core";
import { toolDefinitions } from "./definitions";
import { processorManifest } from "./processor-manifest";
import { assertValidRegistry } from "./validation";

assertValidRegistry(toolDefinitions, processorManifest);

export const tools: readonly ToolDefinition[] = toolDefinitions;

export function getRoutableTools(): readonly ToolDefinition[] {
  return tools.filter((tool) => tool.status !== "coming-soon");
}

export function findTool(category: string, slug: string): ToolDefinition | undefined {
  return getRoutableTools().find((tool) => tool.category === category && tool.slug === slug);
}

export function getToolsByCategory(category: ToolCategory): readonly ToolDefinition[] {
  return tools.filter((tool) => tool.category === category);
}

export function getRelatedTools(current: ToolDefinition, limit = 3): readonly ToolDefinition[] {
  const score = (tool: ToolDefinition): number => {
    let value = tool.category === current.category ? 4 : 0;
    if (tool.accepts.some((mime) => current.outputs.includes(mime))) value += 3;
    if (tool.outputs.some((mime) => current.accepts.includes(mime))) value += 2;
    return value;
  };

  return getRoutableTools()
    .filter((tool) => tool.id !== current.id)
    .map((tool) => ({ tool, score: score(tool) }))
    .sort((a, b) => b.score - a.score || a.tool.title.localeCompare(b.tool.title))
    .slice(0, limit)
    .map(({ tool }) => tool);
}

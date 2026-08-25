import type { ToolOptionDefinition } from "./types";

export interface OptionValidationResult {
  values: Readonly<Record<string, unknown>>;
  errors: Readonly<Record<string, string>>;
}

export function defaultOptions(
  definitions: readonly ToolOptionDefinition[],
): Record<string, unknown> {
  return Object.fromEntries(definitions.map((option) => [option.key, option.defaultValue]));
}

function validateNumber(
  value: unknown,
  option: Extract<ToolOptionDefinition, { type: "number" | "range" }>,
): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a valid number.";
  if (option.min !== undefined && value < option.min) return `Minimum is ${option.min}.`;
  if (option.max !== undefined && value > option.max) return `Maximum is ${option.max}.`;
  return undefined;
}

export function validateOptions(
  definitions: readonly ToolOptionDefinition[],
  input: Readonly<Record<string, unknown>>,
): OptionValidationResult {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const option of definitions) {
    const value = input[option.key] ?? option.defaultValue;
    values[option.key] = value;
    let error: string | undefined;

    switch (option.type) {
      case "number":
      case "range":
        error = validateNumber(value, option);
        break;
      case "boolean":
        if (typeof value !== "boolean") error = "Choose a valid value.";
        break;
      case "color":
        if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
          error = "Choose a valid color.";
        }
        break;
      case "select":
        if (typeof value !== "string" || !option.choices.some((choice) => choice.value === value)) {
          error = "Choose one of the available values.";
        }
        break;
    }

    if (error) errors[option.key] = error;
  }

  return { values, errors };
}

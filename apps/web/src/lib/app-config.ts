const DEFAULT_APP_NAME = "AIO Converter";
const DEFAULT_APP_URL = "http://localhost:4321";
const DEFAULT_API_URL = "http://localhost:8080";

function nonEmpty(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function origin(value: string | undefined, fallback: string, name: string): string {
  const raw = nonEmpty(value, fallback);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${name} must be an http(s) origin without credentials, path, query, or hash.`);
  }
  return parsed.origin;
}

const name = nonEmpty(import.meta.env.PUBLIC_APP_NAME, DEFAULT_APP_NAME);
if (name.length > 80) throw new Error("PUBLIC_APP_NAME must be 80 characters or fewer.");

export const appConfig = Object.freeze({
  name,
  url: origin(import.meta.env.PUBLIC_APP_URL, DEFAULT_APP_URL, "PUBLIC_APP_URL"),
  apiURL: origin(import.meta.env.PUBLIC_API_URL, DEFAULT_API_URL, "PUBLIC_API_URL"),
});

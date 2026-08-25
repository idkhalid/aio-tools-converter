export function extractSSEData(block: string): string | undefined {
  const lines = block.replace(/\r/g, "").split("\n");
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  return data.length > 0 ? data.join("\n") : undefined;
}

export async function* readSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = extractSSEData(block);
        if (data !== undefined) yield data;
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
    const finalData = extractSSEData(buffer);
    if (finalData !== undefined) yield finalData;
  } finally {
    reader.releaseLock();
  }
}

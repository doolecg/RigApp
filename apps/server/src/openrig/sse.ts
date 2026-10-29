/**
 * Reads a daemon SSE stream and calls `onFrame` for every frame that carries data.
 * Resolves when the stream ends; rejects on network errors or abort.
 */
export async function followSse(url: string, onFrame: (frame: string) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(url, { signal, headers: { accept: "text/event-stream" } });
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (/^data:/m.test(frame)) onFrame(frame);
    }
  }
}

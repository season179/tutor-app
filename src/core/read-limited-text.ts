export async function readLimitedTextBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  createTooLargeError: () => Error
): Promise<string | null> {
  const reader = body?.getReader();

  if (!reader) {
    return null;
  }

  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        return text + decoder.decode();
      }

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw createTooLargeError();
      }

      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

// A shareable link holds the source in the URL fragment, compressed with the
// browser's own CompressionStream. The fragment never reaches a server.

const PREFIX = "#code/";

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (text: string): Uint8Array =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));

const pipe = async (bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> =>
  new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());

export const shareHash = async (source: string): Promise<string> =>
  PREFIX + toBase64Url(await pipe(new TextEncoder().encode(source), new CompressionStream("deflate-raw")));

/** The source in a playground link's fragment, or undefined when it has none or it is damaged. */
export const sourceFromHash = async (hash: string): Promise<string | undefined> => {
  if (!hash.startsWith(PREFIX)) return undefined;
  try {
    return new TextDecoder().decode(await pipe(fromBase64Url(hash.slice(PREFIX.length)), new DecompressionStream("deflate-raw")));
  }
  catch {
    return undefined;
  }
};

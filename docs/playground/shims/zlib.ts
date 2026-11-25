// `node:zlib` for the playground worker, on fflate. The engine compresses PDF
// streams and PNG data and inflates PNG data, all synchronously.
import { Buffer } from "node:buffer";
import { unzlibSync, zlibSync } from "fflate";

const bytes = (data: Uint8Array | ArrayBuffer | string): Uint8Array =>
  typeof data === "string" ? Buffer.from(data) : data instanceof Uint8Array ? data : new Uint8Array(data);

export const deflateSync = (data: Uint8Array | ArrayBuffer | string): Buffer =>
  Buffer.from(zlibSync(bytes(data), { level: 6 }));

export const inflateSync = (data: Uint8Array | ArrayBuffer | string): Buffer =>
  Buffer.from(unzlibSync(bytes(data)));

/** WOFF2 fonts need Brotli; the playground serves TrueType fonts only. */
export const brotliDecompressSync = (): never => {
  throw new Error("The playground cannot read WOFF2 fonts. Use a TrueType or OpenType font.");
};

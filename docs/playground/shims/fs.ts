// `node:fs` and `node:fs/promises` for the playground worker. There is no file
// system: every read fails as a missing file, so a `<style>` `@import` or a
// local image path fails with the library's own error for a missing file.

const missing = (path: unknown): Error =>
  Object.assign(new Error(`ENOENT: the playground has no file system, so "${String(path)}" cannot be read`), { code: "ENOENT" });

export const existsSync = (): boolean => false;
export const statSync = (path: unknown, options?: { throwIfNoEntry?: boolean }) => {
  if (options?.throwIfNoEntry === false) return undefined;
  throw missing(path);
};
export const readFileSync = (path: unknown): never => {
  throw missing(path);
};
export const realpathSync = (path: unknown): never => {
  throw missing(path);
};

export const readFile = async (path: unknown): Promise<never> => {
  throw missing(path);
};
export const stat = readFile;
export const realpath = readFile;
export const readdir = readFile;

export default { existsSync, statSync, readFileSync, realpathSync };

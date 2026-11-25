// `node:path` for the playground worker: POSIX rules only. The SFC compiler and
// the engine use it for project-relative file names; the worker has one
// virtual file (`/playground/Playground.vue`) and no file system.

const normalizeParts = (parts: string[], absolute: boolean): string[] => {
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length > 0 && out.at(-1) !== "..") out.pop();
      else if (!absolute) out.push("..");
      continue;
    }
    out.push(part);
  }
  return out;
};

export const sep = "/";
export const delimiter = ":";

export const isAbsolute = (path: string): boolean => path.startsWith("/");

export const normalize = (path: string): string => {
  const absolute = isAbsolute(path);
  const joined = normalizeParts(path.split("/"), absolute).join("/");
  return (absolute ? "/" : "") + (joined || (absolute ? "" : "."));
};

export const join = (...paths: string[]): string => normalize(paths.filter(Boolean).join("/"));

export const resolve = (...paths: string[]): string => {
  let resolved = "";
  for (let index = paths.length - 1; index >= 0 && !isAbsolute(resolved); index--) {
    const path = paths[index];
    if (path) resolved = resolved ? `${path}/${resolved}` : path;
  }
  return normalize(isAbsolute(resolved) ? resolved : `/${resolved}`);
};

export const relative = (from: string, to: string): string => {
  const fromParts = resolve(from).split("/").filter(Boolean);
  const toParts = resolve(to).split("/").filter(Boolean);
  let shared = 0;
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) shared++;
  return [...fromParts.slice(shared).map(() => ".."), ...toParts.slice(shared)].join("/");
};

export const dirname = (path: string): string => {
  const index = path.replace(/\/+$/, "").lastIndexOf("/");
  if (index < 0) return ".";
  return index === 0 ? "/" : path.slice(0, index);
};

export const basename = (path: string, suffix?: string): string => {
  const base = path.replace(/\/+$/, "").split("/").at(-1) ?? "";
  return suffix && base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
};

export const extname = (path: string): string => {
  const base = basename(path);
  const index = base.lastIndexOf(".");
  return index <= 0 ? "" : base.slice(index);
};

const path = { sep, delimiter, isAbsolute, normalize, join, resolve, relative, dirname, basename, extname };

/** Windows paths never occur in the worker; only the absolute check is asked. */
export const win32 = { ...path, sep: "\\", isAbsolute: (value: string) => /^(?:[a-z]:[\\/]|\\\\)/i.test(value) };
export const posix = path;

export default { ...path, posix, win32 };

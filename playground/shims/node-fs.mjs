// Stub for node:fs — FileStateStore is server-side persistence; the
// playground keeps state in memory only. These throw if ever reached.
const off = (name) => () => {
  throw new Error(`fs.${name} unavailable — the playground runs in-memory only`);
};
export const existsSync = off('existsSync');
export const readFileSync = off('readFileSync');
export const renameSync = off('renameSync');
export const writeFileSync = off('writeFileSync');
// node:fs/promises consumers (FileStateStore) — aliased to this same shim.
export const rename = off('rename');
export const writeFile = off('writeFile');

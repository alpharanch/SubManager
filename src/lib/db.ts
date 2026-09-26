import { createStore, delMany, get, getMany, set, setMany } from 'idb-keyval';

// A dedicated IndexedDB database; GitHub Pages sites of one account share an origin.
const store = createStore('submanager', 'kv');

export const db = {
  get: <T>(key: string) => get<T>(key, store),
  getMany: (keys: string[]) => getMany(keys, store),
  set: (key: string, value: unknown) => set(key, value, store),
  setMany: (entries: [string, unknown][]) => setMany(entries, store),
  delMany: (keys: string[]) => delMany(keys, store),
};

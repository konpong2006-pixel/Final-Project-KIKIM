/** In-memory AsyncStorage for the screenshot harness. */
const store = new Map<string, string>();

const AsyncStorage = {
  async clear() { store.clear(); },
  async getItem(key: string) { return store.has(key) ? store.get(key)! : null; },
  async multiGet(keys: string[]) { return keys.map((key) => [key, store.get(key) ?? null]); },
  async removeItem(key: string) { store.delete(key); },
  async setItem(key: string, value: string) { store.set(key, String(value)); },
};

export default AsyncStorage;

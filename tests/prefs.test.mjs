import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, loadPrefs, savePrefs } from "../src/prefs.ts";

test("reading preferences restore sensible defaults and persist valid changes", (t) => {
  const storage = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  });
  t.after(() => original ? Object.defineProperty(globalThis, "localStorage", original) : delete globalThis.localStorage);

  assert.deepEqual(loadPrefs(), DEFAULTS);
  storage.set("omnia.prefs", JSON.stringify({ showMeta: true }));
  assert.deepEqual(loadPrefs(), { ...DEFAULTS, showMeta: true });
  storage.set("omnia.prefs", JSON.stringify({ modelDisplay: "other", collapseLongMessages: "no" }));
  assert.deepEqual(loadPrefs(), DEFAULTS);

  const updated = { ...DEFAULTS, modelDisplay: "overview", collapseLongMessages: false };
  savePrefs(updated);
  assert.deepEqual(loadPrefs(), updated);
});

/**
 * Global store for runtime 3-D model assets (uploaded .glb files).
 *
 * Models are stored as browser Blob URLs so that both React Three Fiber
 * and the Bevy WASM engine can load them.
 *
 * Uses `useSyncExternalStore` for zero-dependency React integration.
 */

import { useSyncExternalStore } from "react";

/* ---- internal state ---- */

const modelUrls = new Map<string, string>();
let snapshot: ReadonlyMap<string, string> = new Map();
const listeners = new Set<() => void>();

function emit() {
  snapshot = new Map(modelUrls); // new ref so React detects the change
  listeners.forEach((fn) => fn());
}

/* ---- public API (call from event handlers) ---- */

/** Store a Blob URL for a given role (e.g. "hero", "enemy"). */
export function addModelUrl(role: string, url: string) {
  // Revoke the previous URL for this role if it exists
  const prev = modelUrls.get(role);
  if (prev) URL.revokeObjectURL(prev);

  modelUrls.set(role, url);
  emit();
}

/** Create a Blob URL from a File and store it under `role`. */
export function addModelFile(role: string, file: File): string {
  const url = URL.createObjectURL(file);
  addModelUrl(role, url);
  return url;
}

/** Remove a model by role and revoke its Blob URL. */
export function removeModel(role: string) {
  const url = modelUrls.get(role);
  if (url) URL.revokeObjectURL(url);
  modelUrls.delete(role);
  emit();
}

/** Get a model URL without subscribing (for one-off reads). */
export function getModelUrl(role: string): string | undefined {
  return modelUrls.get(role);
}

/* ---- React hooks ---- */

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ReadonlyMap<string, string> {
  return snapshot;
}

const emptyMap: ReadonlyMap<string, string> = new Map();
function getServerSnapshot(): ReadonlyMap<string, string> {
  return emptyMap;
}

/** Subscribe to the full model-URL map. Re-renders on any change. */
export function useModelUrls(): ReadonlyMap<string, string> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Subscribe to a single role's URL. */
export function useModelUrl(role: string): string | undefined {
  const models = useModelUrls();
  return models.get(role);
}

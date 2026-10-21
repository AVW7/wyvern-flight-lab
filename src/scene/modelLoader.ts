import { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { getGLTFLoader } from "../render/gltfLoader";

const loader = getGLTFLoader();
const assetCache = new Map<string, GLTF>();

export function isAbortError(error: unknown, signal?: AbortSignal | null): boolean {
  if (signal?.aborted) return true;
  if (!error) return false;
  if (typeof error === "string" && /abort/i.test(error)) return true;
  const err = error as { name?: string; code?: number; message?: string; reason?: unknown } | null;
  if (!err) return false;
  if (err.name === "AbortError" || err.name === "CanceledError" || err.code === 20) return true;
  if (typeof err.message === "string" && /abort/i.test(err.message)) return true;
  if (typeof err.reason === "string" && /abort/i.test(err.reason)) return true;
  return false;
}

export async function loadGltfAsset(url: string, signal?: AbortSignal): Promise<GLTF | null> {
  if (assetCache.has(url)) return assetCache.get(url)!;
  if (signal?.aborted) return null;

  try {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Could not load asset from ${url} (${response.status} ${response.statusText})`);
    }
    if (signal?.aborted) return null;

    const data = await response.arrayBuffer();
    if (signal?.aborted) return null;

    const gltf = await loader.parseAsync(data, url.slice(0, url.lastIndexOf("/") + 1));
    if (signal?.aborted) return null;

    assetCache.set(url, gltf);
    return gltf;
  } catch (error) {
    if (isAbortError(error, signal)) return null;
    throw error;
  }
}

export async function loadModelFile(modelFile: string, signal?: AbortSignal): Promise<GLTF | null> {
  const cacheKey = `file:${modelFile}`;
  if (assetCache.has(cacheKey)) return assetCache.get(cacheKey)!;
  const url = `/models/${encodeURIComponent(modelFile)}`;
  const gltf = await loadGltfAsset(url, signal);
  if (gltf) {
    assetCache.set(cacheKey, gltf);
  }
  return gltf;
}

export function clearModelCache(): void {
  assetCache.clear();
}

import type { WebGLRenderer } from "three";

export function releaseWebGLContext(renderer: WebGLRenderer): void {
  try {
    renderer.dispose();
  } catch {}
  try {
    renderer.forceContextLoss();
  } catch {}
}

export function releaseWebGLRenderer(renderer: WebGLRenderer): void {
  releaseWebGLContext(renderer);
  renderer.domElement?.remove();
}

export function releaseCanvasContext(canvas: HTMLCanvasElement | null | undefined): void {
  try {
    const context =
      (canvas?.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (canvas?.getContext("webgl") as WebGLRenderingContext | null);
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {}
}

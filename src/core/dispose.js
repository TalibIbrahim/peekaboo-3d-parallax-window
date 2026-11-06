/**
 * Frees the GPU resources (geometries, materials and their textures) used by
 * everything under `root`. Safe to call on shared resources: dispose() is
 * idempotent, and three.js re-uploads anything that gets rendered again.
 */
export function disposeObject(root) {
  const seen = new Set();
  const once = (res) => {
    if (res && !seen.has(res)) {
      seen.add(res);
      res.dispose?.();
    }
  };

  root.traverse((obj) => {
    once(obj.geometry);
    for (const mat of [].concat(obj.material || [])) {
      for (const value of Object.values(mat)) {
        if (value?.isTexture) once(value);
      }
      if (mat.uniforms) {
        for (const u of Object.values(mat.uniforms)) {
          // Skip render-target textures; their owner disposes them.
          if (u?.value?.isTexture && !u.value.isRenderTargetTexture) once(u.value);
        }
      }
      once(mat);
    }
  });
  root.clear();
}

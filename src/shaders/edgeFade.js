/**
 * Shared GLSL edge-fade function for pop-out geometry and particles.
 * 
 * Design rule:
 * "Pop-out particles must use the shared GLSL edge fade. In the vertex shader,
 * compute ndc = clip.xy / clip.w, e = 1.0 - max(abs(ndc.x), abs(ndc.y)),
 * and fade = worldZ > 0.0 ? smoothstep(0.02, 0.2, e) : 1.0, then multiply alpha by fade."
 */

export const edgeFadeVertexGLSL = /* glsl */ `
float computeEdgeFade(vec4 clipPos, float worldZ) {
  if (clipPos.w <= 0.0) return 0.0;
  vec2 ndc = clipPos.xy / clipPos.w;
  float e = 1.0 - max(abs(ndc.x), abs(ndc.y));
  return worldZ > 0.0 ? smoothstep(0.02, 0.2, e) : 1.0;
}
`;

export const edgeFadeFragmentGLSL = /* glsl */ `
// Fragment pass-through or modifier
`;

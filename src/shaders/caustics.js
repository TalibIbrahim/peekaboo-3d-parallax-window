/**
 * Domain-warped water caustics GLSL functions for underwater rendering.
 */

export const causticsGLSL = /* glsl */ `
float causticCell(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float minDist = 1.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      // Hash pseudo-random point
      vec2 point = fract(sin(vec2(dot(i + neighbor, vec2(127.1, 311.7)),
                                  dot(i + neighbor, vec2(269.5, 183.3)))) * 43758.5453);
      point = 0.5 + 0.5 * sin(point * 6.28318);
      vec2 diff = neighbor + point - f;
      minDist = min(minDist, length(diff));
    }
  }
  return minDist;
}

float computeCaustics(vec2 uv, float time) {
  vec2 p = uv * 0.15;
  // Domain warp
  vec2 warp1 = vec2(sin(p.y * 2.5 + time * 0.8), cos(p.x * 2.5 + time * 0.7)) * 0.4;
  vec2 warp2 = vec2(cos(p.y * 3.5 - time * 0.6), sin(p.x * 3.5 - time * 0.9)) * 0.3;
  
  float c1 = causticCell(p * 4.0 + warp1 + time * 0.2);
  float c2 = causticCell(p * 7.0 - warp2 - time * 0.3);
  
  float caustics = pow(1.0 - c1, 3.5) + pow(1.0 - c2, 3.0) * 0.7;
  return clamp(caustics, 0.0, 2.0);
}
`;

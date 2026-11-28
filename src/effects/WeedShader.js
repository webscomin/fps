// Шейдер экрана «косяка»: смена оттенка, волны, насыщенность и радужная виньетка.
// Шлейф (пинг-понг предыдущего кадра) добавляется отдельным AfterimagePass.

export const WeedShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    strength: { value: 0 },
    hue: { value: 0 },
    reduced: { value: 0 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float strength;
    uniform float hue;
    uniform float reduced;
    varying vec2 vUv;

    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }

    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main() {
      float s = clamp(strength, 0.0, 1.0);
      float red = clamp(reduced, 0.0, 1.0);
      float amp = 0.006 * s * mix(1.0, 0.5, red);
      float slow = time * mix(1.0, 0.5, red);

      // Два наложенных волнообразных смещения UV
      vec2 uv = vUv;
      uv.x += sin(uv.y * 8.0 + slow * 0.9) * amp;
      uv.y += cos(uv.x * 7.0 + slow * 1.1) * amp;
      uv.x += sin(uv.y * 19.0 - slow * 1.3) * amp * 0.5;
      uv.y += cos(uv.x * 17.0 + slow * 1.6) * amp * 0.5;

      vec3 col = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;

      // Смена оттенка по кругу и повышенная насыщенность
      vec3 hsv = rgb2hsv(col);
      hsv.x = fract(hsv.x + hue);
      hsv.y = clamp(hsv.y * (1.15 + 0.15 * s), 0.0, 1.0);
      col = hsv2rgb(hsv);

      // Радужная виньетка с низкочастотной пульсацией
      vec2 p = vUv - 0.5;
      float dist = length(p) * 1.41421356;
      float edge = smoothstep(0.55, 1.0, dist);
      float pulse = 0.75 + 0.25 * sin(slow * 0.9);
      vec3 rainbow = hsv2rgb(vec3(fract(hue + dist * 0.55 + slow * 0.03), 0.75, 1.0));
      col = mix(col, rainbow, edge * s * 0.35 * pulse);

      gl_FragColor = vec4(col, 1.0);
    }
  `
};

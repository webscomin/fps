// Шейдер «пьяного» экрана (водка): двоение, волны, радиальное размытие и тёплый оттенок.
// Порядок в цепочке: после bloom, перед weed и виньеткой.

export const DrunkShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    strength: { value: 0 },
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
    uniform float reduced;
    varying vec2 vUv;

    vec3 sampleScreen(vec2 uv) {
      return texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
    }

    void main() {
      float s = clamp(strength, 0.0, 1.0);
      float red = clamp(reduced, 0.0, 1.0);
      float ampScale = mix(1.0, 0.5, red);
      float slow = time * mix(1.0, 0.5, red);

      // Волнистое искажение UV: медленные синусы по обеим осям
      float waveAmp = (0.003 + 0.01 * s) * ampScale;
      vec2 uv = vUv;
      uv.x += sin(uv.y * 9.0 + slow * 1.25) * waveAmp;
      uv.y += cos(uv.x * 7.0 + slow * 1.05) * waveAmp;

      // Двоение: три горизонтальных сэмпла со смещением
      float doubleAmp = (0.004 + 0.012 * s) * ampScale;
      float off = doubleAmp * (0.75 + 0.35 * sin(slow * 1.6 + uv.y * 3.0));
      vec3 col = (
        sampleScreen(uv + vec2(off, 0.0)) +
        sampleScreen(uv) +
        sampleScreen(uv - vec2(off, 0.0))
      ) / 3.0;

      // Радиальное размытие по краям: 3 сэмпла достаточно для мультяшного смаза
      vec2 dir = uv - 0.5;
      float edge = smoothstep(0.18, 0.78, length(dir));
      float blurRadius = edge * (0.004 + 0.022 * s) * ampScale;
      vec3 blurCol = vec3(0.0);
      for (int i = 0; i < 3; i++) {
        float f = float(i) - 1.0;
        blurCol += sampleScreen(uv + dir * blurRadius * f);
      }
      blurCol /= 3.0;
      col = mix(col, blurCol, edge * (0.2 + 0.55 * s));

      // Лёгкое снижение яркости и тёплый оттенок на сильных значениях
      col *= mix(1.0, 0.9, s * ampScale);
      col += vec3(0.05, 0.018, -0.015) * s;

      gl_FragColor = vec4(col, 1.0);
    }
  `
};

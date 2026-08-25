export const vertexShader = /*glsl*/`#version 300 es

in vec2 inPosition;
out vec2 fragUV;

void main() {
    gl_Position = vec4(inPosition, 0.0, 1.0);
    fragUV = (inPosition + 1.0) / 2.0;
}
`;

export const fragmentShader = /*glsl*/`#version 300 es
precision highp float;

uniform sampler2D uInputTexture;
uniform int uBlendMode;
uniform float uAlphaMixFactor;
uniform int uOverlaySampleCount;
uniform vec2 uOverlayRotCS[12];

in vec2 fragUV;
out vec4 outColor;

// @what - Keep this in sync with NCSVisualizer.tsx upload cap
const int MAX_OVERLAY_SAMPLES = 12;

// [[ncs.outputComposite.blendHelpers]]
// @what - per-channel RGB blend helpers for the final original-vs-rotated overlay
// @note - a is the base (original), b is the blend (rotated)
vec3 ncsBlendMultiply(vec3 a, vec3 b) { return a * b; }
vec3 ncsBlendScreen(vec3 a, vec3 b) { return 1.0 - (1.0 - a) * (1.0 - b); }
vec3 ncsBlendOverlay(vec3 a, vec3 b) {
    return mix(2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b), step(0.5, a));
}
vec3 ncsBlendSoftLight(vec3 a, vec3 b) {
    vec3 low = 2.0 * a * b + a * a * (1.0 - 2.0 * b);
    vec3 high = 2.0 * a * (1.0 - b) + sqrt(a) * (2.0 * b - 1.0);
    return mix(low, high, step(0.5, b));
}
vec3 ncsBlendHardLight(vec3 a, vec3 b) { return ncsBlendOverlay(b, a); }
vec3 ncsBlendColorDodge(vec3 a, vec3 b) {
    vec3 denom = max(1.0 - b, 0.00001);
    return min(mix(a / denom, vec3(1.0), step(vec3(0.999999), b)), vec3(1.0));
}
vec3 ncsBlendColorBurn(vec3 a, vec3 b) {
    vec3 denom = max(b, 0.00001);
    return max(mix(1.0 - min((1.0 - a) / denom, 1.0), vec3(0.0), step(b, vec3(0.000001))), vec3(0.0));
}
vec3 ncsBlendDifference(vec3 a, vec3 b) { return abs(a - b); }
vec3 ncsBlendExclusion(vec3 a, vec3 b) { return a + b - 2.0 * a * b; }
vec3 ncsBlendDarken(vec3 a, vec3 b) { return min(a, b); }
vec3 ncsBlendLighten(vec3 a, vec3 b) { return max(a, b); }
vec3 ncsBlendLinearDodge(vec3 a, vec3 b) { return min(a + b, vec3(1.0)); }
vec3 ncsBlendLinearBurn(vec3 a, vec3 b) { return max(a + b - 1.0, vec3(0.0)); }
vec3 ncsBlendVividLight(vec3 a, vec3 b) {
    return mix(ncsBlendColorBurn(a, 2.0 * b), ncsBlendColorDodge(a, 2.0 * (b - 0.5)), step(0.5, b));
}
vec3 ncsBlendPinLight(vec3 a, vec3 b) {
    return mix(ncsBlendDarken(a, 2.0 * b), ncsBlendLighten(a, 2.0 * (b - 0.5)), step(0.5, b));
}
vec3 ncsBlendHardMix(vec3 a, vec3 b) { return step(vec3(1.0), a + b); }
vec3 ncsBlendSubtract(vec3 a, vec3 b) { return max(a - b, vec3(0.0)); }
vec3 ncsBlendDivide(vec3 a, vec3 b) { return a / max(b, 0.00001); }

// [[ncs.outputComposite.rotateUv]]
// @what - Rotate sampling UV around center using precomputed cos/sin
// @param - uv {vec2}
// @param - cs {vec2} [cos(theta), sin(theta)]
vec2 ncsRotateUv(vec2 uv, vec2 cs) {
    vec2 centered = uv - 0.5;
    vec2 rotated = vec2(
        cs.x * centered.x - cs.y * centered.y,
        cs.y * centered.x + cs.x * centered.y
    );
    return rotated + 0.5;
}

// [[ncs.outputComposite.blendByMode]]
// @what - Blend helper for non-alpha_mix modes
// @why - alpha_mix needs N-sample-aware averaging, so it is handled separately in main()
vec3 ncsBlendByMode(vec3 base, vec3 blend) {
    if (uBlendMode == 1) {
        return min(base + blend, vec3(1.0));
    } else if (uBlendMode == 2) {
        return max(base, blend);
    } else if (uBlendMode == 3) {
        return ncsBlendMultiply(base, blend);
    } else if (uBlendMode == 4) {
        return ncsBlendScreen(base, blend);
    } else if (uBlendMode == 5) {
        return ncsBlendOverlay(base, blend);
    } else if (uBlendMode == 6) {
        return ncsBlendSoftLight(base, blend);
    } else if (uBlendMode == 7) {
        return ncsBlendHardLight(base, blend);
    } else if (uBlendMode == 8) {
        return ncsBlendColorDodge(base, blend);
    } else if (uBlendMode == 9) {
        return ncsBlendColorBurn(base, blend);
    } else if (uBlendMode == 10) {
        return ncsBlendDifference(base, blend);
    } else if (uBlendMode == 11) {
        return ncsBlendExclusion(base, blend);
    } else if (uBlendMode == 12) {
        return ncsBlendDarken(base, blend);
    } else if (uBlendMode == 13) {
        return ncsBlendLighten(base, blend);
    } else if (uBlendMode == 14) {
        return ncsBlendLinearDodge(base, blend);
    } else if (uBlendMode == 15) {
        return ncsBlendLinearBurn(base, blend);
    } else if (uBlendMode == 16) {
        return ncsBlendVividLight(base, blend);
    } else if (uBlendMode == 17) {
        return ncsBlendPinLight(base, blend);
    } else if (uBlendMode == 18) {
        return ncsBlendHardMix(base, blend);
    } else if (uBlendMode == 19) {
        return ncsBlendSubtract(base, blend);
    } else if (uBlendMode == 20) {
        return ncsBlendDivide(base, blend);
    }
    return blend;
}

void main() {
    // @what - clamp runtime sample count to shader capacity
    int sampleCount = clamp(uOverlaySampleCount, 1, MAX_OVERLAY_SAMPLES);
    vec4 firstSample = texture(uInputTexture, ncsRotateUv(fragUV, uOverlayRotCS[0]));
    float alphaMax = firstSample.a;

    // @what - blend mode mapping
    // @values - 0: alpha_mix, 1: additive, 2: max, 3: multiply, 4: screen, 5: overlay, 6: soft_light, 7: hard_light, 8: color_dodge, 9: color_burn, 10: difference, 11: exclusion, 12: darken, 13: lighten, 14: linear_dodge, 15: linear_burn, 16: vivid_light, 17: pin_light, 18: hard_mix, 19: subtract, 20: divide
    if (uBlendMode == 0) {
        // @what - alpha_mix general case:
        // @how - preserve sample0 as base and mix toward average(sample1..N-1)
        vec3 othersSum = vec3(0.0);
        float othersCount = 0.0;
        for (int i = 1; i < MAX_OVERLAY_SAMPLES; i++) {
            if (i >= sampleCount) break;
            vec4 s = texture(uInputTexture, ncsRotateUv(fragUV, uOverlayRotCS[i]));
            othersSum += s.rgb;
            othersCount += 1.0;
            alphaMax = max(alphaMax, s.a);
        }
        vec3 othersAvg = othersCount > 0.0 ? (othersSum / othersCount) : firstSample.rgb;
        vec3 mixed = mix(firstSample.rgb, othersAvg, clamp(uAlphaMixFactor, 0.0, 1.0));
        outColor = vec4(clamp(mixed, 0.0, 1.0), alphaMax);
        return;
    }

    vec3 result = firstSample.rgb;
    for (int i = 1; i < MAX_OVERLAY_SAMPLES; i++) {
        if (i >= sampleCount) break;
        vec4 s = texture(uInputTexture, ncsRotateUv(fragUV, uOverlayRotCS[i]));
        result = ncsBlendByMode(result, s.rgb);
        alphaMax = max(alphaMax, s.a);
    }
    outColor = vec4(clamp(result, 0.0, 1.0), alphaMax);
}
`;

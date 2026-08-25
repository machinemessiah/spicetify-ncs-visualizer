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

in vec2 fragUV;
out vec4 outColor;

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

void main() {
    // @what - original and 180deg-rotated samples from the same texture
    vec4 original = texture(uInputTexture, fragUV);
    vec4 rotated = texture(uInputTexture, 1.0 - fragUV);

    // @what - blend mode mapping
    // @values - 0: alpha_mix, 1: additive, 2: max, 3: multiply, 4: screen, 5: overlay, 6: soft_light, 7: hard_light, 8: color_dodge, 9: color_burn, 10: difference, 11: exclusion, 12: darken, 13: lighten, 14: linear_dodge, 15: linear_burn, 16: vivid_light, 17: pin_light, 18: hard_mix, 19: subtract, 20: divide
    if (uBlendMode == 1) {
        outColor = min(original + rotated, vec4(1.0));
        return;
    }
    if (uBlendMode == 2) {
        outColor = max(original, rotated);
        return;
    }
    // @what - default mode: linear interpolation between original and rotated
    outColor = mix(original, rotated, clamp(uAlphaMixFactor, 0.0, 1.0));
    return;
}
`;

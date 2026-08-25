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

void main() {
    // @what - original and 180deg-rotated samples from the same texture
    vec4 original = texture(uInputTexture, fragUV);
    vec4 rotated = texture(uInputTexture, 1.0 - fragUV);

    // @what - blend mode mapping
    // @values - 0: alpha_mix, 1: additive, 2: max
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

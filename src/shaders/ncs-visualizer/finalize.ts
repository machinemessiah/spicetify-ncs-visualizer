export const vertexShader = /*glsl*/`#version 300 es

uniform vec3 uOutputColor;
in vec2 inPosition;

out vec2 fragUV;
out vec3 fragOutputColor;

void main() {
    gl_Position = vec4(inPosition, 0.0, 1.0);
    fragUV = (inPosition + 1.0) / 2.0;
    fragOutputColor = uOutputColor;
}
`;
export const fragmentShader = /*glsl*/`#version 300 es
precision highp float;

uniform sampler2D uBlurredTexture;
uniform sampler2D uOriginalTexture;
// @what - global rotation angle [radians] to rotate final composite in-shader
uniform float uRotation;

in vec2 fragUV;
in vec3 fragOutputColor;

out vec4 outColor;

void main() {
    // @how - rotate the sampling UV around the center (0.5, 0.5)
    vec2 centered = fragUV - 0.5;
    float c = cos(uRotation), s = sin(uRotation);
    vec2 uv = mat2(c, -s, s, c) * centered + 0.5;

    float value = max(texture(uBlurredTexture, uv).r, texture(uOriginalTexture, uv).r);
    outColor = vec4(fragOutputColor * value, value);
}
`;

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
uniform float uFadeFactor;

in vec2 fragUV;
out vec4 outColor;

void main() {
    vec4 color = texture(uInputTexture, fragUV);
    outColor = color * uFadeFactor;
}
`;

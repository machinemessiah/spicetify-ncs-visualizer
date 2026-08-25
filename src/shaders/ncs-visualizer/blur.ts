// https://developer.nvidia.com/gpugems/gpugems3/part-vi-gpu-computing/chapter-40-incremental-computation-gaussian
// https://github.com/mozilla/gecko-dev/blob/23808d46cde6155213b1230675b00a0a426f466e/gfx/wr/webrender/res/cs_blur.glsl#L140-L157

export const vertexShader = /*glsl*/ `#version 300 es

uniform float uBlurRadius;
// [[blur.uBlurKernelQuality]]
// @what - tap-count multiplier after radius sizing (from window.visualizer.blurKernelQuality)
// @how - fragSupport = ceil(1.5 * uBlurRadius) * int(uBlurKernelQuality)
// @purpose - more taps along the blur axis = creamier bloom; fewer = cheaper/crisper
// @note - 1.5 * radius sizes the kernel to the blur width; quality then densifies samples inside that width
uniform float uBlurKernelQuality;
uniform vec2 uBlurDirection;

in vec2 inPosition;

out vec2 fragUV;
flat out vec2 fragBlurDirection;
flat out int fragSupport;
flat out vec3 fragGaussCoefficients;

float calculateGaussianTotal(int support, vec3 fragGaussCoefficients) {
    float total = fragGaussCoefficients.x;
    for (int i = 1; i < support; i++) {
        fragGaussCoefficients.xy *= fragGaussCoefficients.yz;
        total += 2.0 * fragGaussCoefficients.x;
    }
    return total;
}

void main() {
    // @what - sample budget for the separable Gaussian along uBlurDirection
    // @meaning - higher uBlurKernelQuality → smoother spatial blur, more GPU cost
    fragSupport = int(ceil(1.5 * uBlurRadius)) * int(uBlurKernelQuality);
    fragGaussCoefficients = vec3(1.0 / (sqrt(2.0 * 3.14159265) * uBlurRadius), exp(-0.5 / (uBlurRadius * uBlurRadius)), 0.0);
    fragGaussCoefficients.z = fragGaussCoefficients.y * fragGaussCoefficients.y;
    fragGaussCoefficients.x /= calculateGaussianTotal(fragSupport, fragGaussCoefficients);

    gl_Position = vec4(inPosition, 0.0, 1.0);
    fragUV = (inPosition + 1.0) / 2.0;
    fragBlurDirection = uBlurDirection;
}
`;
export const fragmentShader = /*glsl*/ `#version 300 es
precision highp float;

uniform sampler2D uInputTexture;

in vec2 fragUV;
flat in vec2 fragBlurDirection;
flat in int fragSupport;
flat in vec3 fragGaussCoefficients;

out float outColor;

void main() {
    vec3 gaussCoefficients = fragGaussCoefficients;
    outColor = gaussCoefficients.x * texture(uInputTexture, fragUV).r;

    for (int i = 1; i < fragSupport; i += 2) {
        gaussCoefficients.xy *= gaussCoefficients.yz;
        float coefficientSum = gaussCoefficients.x;
        gaussCoefficients.xy *= gaussCoefficients.yz;
        coefficientSum += gaussCoefficients.x;

        float pixelRatio = gaussCoefficients.x / coefficientSum;
        vec2 offset = (float(i) + pixelRatio) * fragBlurDirection;

        outColor += coefficientSum * (texture(uInputTexture, fragUV + offset).r + texture(uInputTexture, fragUV - offset).r);
    }
}
`;

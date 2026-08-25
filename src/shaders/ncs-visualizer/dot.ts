export const vertexShader = /*glsl*/`#version 300 es

uniform int uDotCount;
uniform float uDotRadius;
uniform float uDotRadiusPX;

uniform sampler2D uParticleTexture;

in vec2 inPosition;

out vec2 fragUV;
out float fragDotRadiusPX;

void main() {
    ivec2 dotIndex = ivec2(gl_InstanceID % uDotCount, gl_InstanceID / uDotCount);
    vec2 dotCenter = texelFetch(uParticleTexture, dotIndex, 0).xy;

    // @what - Cull near-origin instances
    // @why - to prevent a persistent center dot
    float d2 = dot(dotCenter, dotCenter);
    bool kill = d2 < 1e-8;

    // @how - If 'kill', set radius to 0 so fragment shader outputs 0 everywhere
    gl_Position = vec4(dotCenter + inPosition * uDotRadius * (1.0 + 1.0 / uDotRadiusPX), 0.0, 1.0);
    fragUV = inPosition;
    fragDotRadiusPX = kill ? 0.0 : (uDotRadiusPX + 1.0);

    // @note - This is the original code that doesn't cull near-origin instances
    /*-*
    gl_Position = vec4(dotCenter + inPosition * uDotRadius * (1.0 + 1.0 / uDotRadiusPX), 0.0, 1.0);
    fragUV = inPosition;
    fragDotRadiusPX = uDotRadiusPX + 1.0;
    /*-*/
}
`;
export const fragmentShader = /*glsl*/`#version 300 es
precision highp float;

// [[dot.uDotShape]]
// @what - particle glyph selector from window.visualizer.dotShape
// @values - 0 circle | 1 triangle | 2 square | 3 pentagon | 4 hexagon
// @note - keep ints in sync with DOT_SHAPE_TO_INT in visualizer.defaults.ts
uniform int uDotShape;

in vec2 fragUV;
in float fragDotRadiusPX;
out float outColor;

// @@ sdRegularPolygon
// @desc - distance-like field for a regular N-gon inscribed near the unit circle
// @how - fold the plane into one wedge, then measure how far past the flat edge you are
// @param - p {vec2} local UV in roughly [-1,1]
// @param - n {float} side count (3, 5, 6, ...)
// @return - ~0 at center, ~1 near the flat edge (same soft-edge convention as length(p) for circles)
float sdRegularPolygon(vec2 p, float n) {
    // @what - half-angle of one wedge; rotate so a flat sits on top (upright glyph)
    float an = 3.14159265359 / n;
    float ac = 6.28318530718 / n;
    // @how - angle of p, snap into one wedge around the top flat
    float at = atan(p.x, p.y);
    float d = cos(floor(0.5 + at / ac) * ac - at) * length(p);
    // @meaning - divide by cos(an) so the flat edge lands near d = 1 (matches circle’s soft edge)
    return d / cos(an);
}

// @@ shapeDist
// @desc - normalized “inside→edge” distance for the selected glyph
// @meaning - soft edge uses (1.0 - d) * fragDotRadiusPX; d < 1 is filled, d > 1 fades out
float shapeDist(vec2 p, int shape) {
    // @what - circle: radial distance (original behaviour)
    if (shape == 0) {
        return length(p);
    }
    // @what - equilateral triangle (N = 3)
    if (shape == 1) {
        return sdRegularPolygon(p, 3.0);
    }
    // @what - square: Chebyshev distance — fills the quad’s axis-aligned edges
    if (shape == 2) {
        return max(abs(p.x), abs(p.y));
    }
    // @what - regular pentagon (N = 5)
    if (shape == 3) {
        return sdRegularPolygon(p, 5.0);
    }
    // @what - regular hexagon (N = 6)
    if (shape == 4) {
        return sdRegularPolygon(p, 6.0);
    }
    // @fallback - unknown → circle
    return length(p);
}

void main() {
    // @what - soft glyph mask; shape only changes the silhouette, not particle size uniforms
    float d = shapeDist(fragUV, uDotShape);
    float t = clamp((1.0 - d) * fragDotRadiusPX, 0.0, 1.0);
    outColor = t;
}
`;

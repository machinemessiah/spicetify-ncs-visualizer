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

uniform float uNoiseOffset;
uniform float uAmplitude;
uniform int uSeed;

uniform float uDotSpacing;
uniform float uDotOffset;

// @what - shared layout radial scale (UI: "Radius"; historically sphere-only)
uniform float uSphereRadius;
uniform float uFeather;

uniform float uNoiseFrequency;
uniform float uNoiseAmplitude;

// @what - song-progress XY orbit leftover (Option B); not conflated with layoutSpin
uniform float uOrbitAngle;

// [[particle.layoutMode]]
// @values - 0 sphere | 1 disc | 2 cylinder | 3 torus
// @note - keep in sync with LAYOUT_MODE_TO_INT in visualizer.defaults.ts
uniform int uLayoutMode;

// [[particle.layoutSpin]]
// @what - continuous tumble angle in radians (from wall-clock * rev/sec in JS)
uniform float uLayoutSpin;
// @values - 0 x | 1 y | 2 z  (keep in sync with LAYOUT_SPIN_AXIS_TO_INT)
uniform int uLayoutSpinAxis;

// [[particle.layoutOrient]]
// @what - stationary pose angles in radians (JS converts from degrees layoutOrientX/Y/Z)
// @how - applied X → Y → Z after layout map, before continuous layoutSpin
// @meaning - fixed tilt/pose of the shape; spin still tumbles on top (or speed 0 = frozen pose)
uniform float uLayoutOrientX;
uniform float uLayoutOrientY;
uniform float uLayoutOrientZ;

in vec2 fragUV;
out vec2 outColor;

// https://github.com/Auburn/FastNoiseLite

const float FREQUENCY = 0.01;

const float GAIN = 0.5;
const float LACUNARITY = 1.5;
const float FRACTAL_BOUNDING = 1.0 / 1.75;

// @magic - torus tube thickness as a fraction of major radius (no Tune knob in v1)
const float TORUS_MINOR_FRAC = 0.35;

const ivec3 PRIMES = ivec3(501125321, 1136930381, 1720413743);

const float GRADIENTS_3D[] = float[](
    0., 1., 1., 0.,  0.,-1., 1., 0.,  0., 1.,-1., 0.,  0.,-1.,-1., 0.,
    1., 0., 1., 0., -1., 0., 1., 0.,  1., 0.,-1., 0., -1., 0.,-1., 0.,
    1., 1., 0., 0., -1., 1., 0., 0.,  1.,-1., 0., 0., -1.,-1., 0., 0.,
    0., 1., 1., 0.,  0.,-1., 1., 0.,  0., 1.,-1., 0.,  0.,-1.,-1., 0.,
    1., 0., 1., 0., -1., 0., 1., 0.,  1., 0.,-1., 0., -1., 0.,-1., 0.,
    1., 1., 0., 0., -1., 1., 0., 0.,  1.,-1., 0., 0., -1.,-1., 0., 0.,
    0., 1., 1., 0.,  0.,-1., 1., 0.,  0., 1.,-1., 0.,  0.,-1.,-1., 0.,
    1., 0., 1., 0., -1., 0., 1., 0.,  1., 0.,-1., 0., -1., 0.,-1., 0.,
    1., 1., 0., 0., -1., 1., 0., 0.,  1.,-1., 0., 0., -1.,-1., 0., 0.,
    0., 1., 1., 0.,  0.,-1., 1., 0.,  0., 1.,-1., 0.,  0.,-1.,-1., 0.,
    1., 0., 1., 0., -1., 0., 1., 0.,  1., 0.,-1., 0., -1., 0.,-1., 0.,
    1., 1., 0., 0., -1., 1., 0., 0.,  1.,-1., 0., 0., -1.,-1., 0., 0.,
    0., 1., 1., 0.,  0.,-1., 1., 0.,  0., 1.,-1., 0.,  0.,-1.,-1., 0.,
    1., 0., 1., 0., -1., 0., 1., 0.,  1., 0.,-1., 0., -1., 0.,-1., 0.,
    1., 1., 0., 0., -1., 1., 0., 0.,  1.,-1., 0., 0., -1.,-1., 0., 0.,
    1., 1., 0., 0.,  0.,-1., 1., 0., -1., 1., 0., 0.,  0.,-1.,-1., 0.
);

float smootherStep(float t) {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}
vec3 smootherStep(vec3 coord) {
    return vec3(smootherStep(coord.x), smootherStep(coord.y), smootherStep(coord.z));
}

int hash(int seed, ivec3 primed) {
    return (seed ^ primed.x ^ primed.y ^ primed.z) * 0x27d4eb2d;
}

float gradCoord(int seed, ivec3 primed, vec3 d) {
    int hash = hash(seed, primed);
    hash ^= hash >> 15;
    hash &= 63 << 2;
    return d.x * GRADIENTS_3D[hash] + d.y * GRADIENTS_3D[hash | 1] + d.z * GRADIENTS_3D[hash | 2];
}

float perlinSingle(int seed, vec3 coord) {
    ivec3 coord0 = ivec3(floor(coord));
    vec3 d0 = coord - vec3(coord0);
    vec3 d1 = d0 - 1.0;
    vec3 s = smootherStep(d0);
    coord0 *= PRIMES;
    ivec3 coord1 = coord0 + PRIMES;
    float xf00 = mix(gradCoord(seed,                              coord0,                     d0), gradCoord(seed,          ivec3(coord1.x, coord0.yz),      vec3(d1.x, d0.yz)), s.x);
    float xf10 = mix(gradCoord(seed, ivec3(coord0.x, coord1.y, coord0.z), vec3(d0.x, d1.y, d0.z)), gradCoord(seed,          ivec3(coord1.xy, coord0.z),      vec3(d1.xy, d0.z)), s.x);
    float xf01 = mix(gradCoord(seed,          ivec3(coord0.xy, coord1.z),      vec3(d0.xy, d1.z)), gradCoord(seed, ivec3(coord1.x, coord0.y, coord1.z), vec3(d1.x, d0.y, d1.z)), s.x);
    float xf11 = mix(gradCoord(seed,          ivec3(coord0.x, coord1.yz),      vec3(d0.x, d1.yz)), gradCoord(seed,                              coord1,                     d1), s.x);
    float yf0 = mix(xf00, xf10, s.y);
    float yf1 = mix(xf01, xf11, s.y);
    return mix(yf0, yf1, s.z) * 0.964921414852142333984375f;
}

float fractalNoise(vec3 coord) {
    return perlinSingle(uSeed, coord) * FRACTAL_BOUNDING
        + perlinSingle(uSeed + 1, coord * LACUNARITY) * FRACTAL_BOUNDING * GAIN
        + perlinSingle(uSeed + 2, coord * LACUNARITY * LACUNARITY) * FRACTAL_BOUNDING * GAIN * GAIN;
}

// @@ rotateAxisAngle
// @desc - rotate point p around a unit axis by angle radians (Rodrigues)
// @how - axis 0/1/2 → world X/Y/Z; builds the axis vector then applies the formula
// @meaning - this is the “layoutSpin” tumble — still 3D math, still flattened later
vec3 rotateAxisAngle(vec3 p, int axis, float angle) {
    vec3 a = axis == 0 ? vec3(1.0, 0.0, 0.0)
           : axis == 2 ? vec3(0.0, 0.0, 1.0)
           : vec3(0.0, 1.0, 0.0); // @default - Y (vertical pole)
    float c = cos(angle);
    float s = sin(angle);
    // @formula - p' = p*c + (a×p)*s + a*(a·p)*(1−c)
    return p * c + cross(a, p) * s + a * dot(a, p) * (1.0 - c);
}

// @@ applyLayout
// @desc - map a seed point (strip + noise) onto the chosen 3D layout
// @param - seed {vec3} roughly: xy from UV strip, z from noise height
// @param - mode {int} layoutMode int
// @param - radius {float} shared layout scale (uSphereRadius)
// @return - 3D position on/inside that layout (before spin + feather)
vec3 applyLayout(vec3 seed, int mode, float radius) {
    // [[particle.layout.sphere]]
    // @what - classic: push the seed onto a sphere of radius
    // @how - normalize direction, clamp length, scale
    // @meaning - what you see is the circular orthographic shadow of that sphere
    if (mode == 0) {
        float d = length(seed);
        // @note - avoid divide-by-zero if seed lands at origin
        if (d < 1e-8) {
            return vec3(0.0);
        }
        vec3 dir = seed / d;
        d = min(radius, d);
        return dir * d;
    }

    // [[particle.layout.disc]]
    // @what - flat circular field in the XY plane (ignore seed Z)
    // @how - take seed.xy, clamp length to radius, Z = 0
    // @meaning - looks like a 2D disc of particles; spin around X/Y will “tilt” it in projection
    if (mode == 1) {
        vec2 xy = seed.xy;
        float d = length(xy);
        if (d > 1e-8) {
            xy = (xy / d) * min(radius, d);
        }
        return vec3(xy, 0.0);
    }

    // [[particle.layout.cylinder]]
    // @what - wrap the strip around a vertical tube
    // @how - θ from seed.x (around the tube), height from seed.y, radius fixed
    // @meaning - side-on ring/tube silhouette; spinning Y rotates like a lathe
    if (mode == 2) {
        // @how - map strip X into a full turn; Y stays as height along the tube
        float theta = seed.x * 6.28318530718;
        float h = seed.y * radius;
        return vec3(cos(theta) * radius, h, sin(theta) * radius);
    }

    // [[particle.layout.torus]]
    // @what - donut: major ring radius + minor tube radius
    // @how - θ from seed.x (around the big ring), φ from seed.y (around the tube)
    // @magic - minor = TORUS_MINOR_FRAC * major (no Tune knob yet)
    // @meaning - classic torus silhouette when viewed orthographically
    if (mode == 3) {
        float major = radius;
        float minor = major * TORUS_MINOR_FRAC;
        float theta = seed.x * 6.28318530718;
        float phi = seed.y * 6.28318530718;
        float ring = major + minor * cos(phi);
        return vec3(ring * cos(theta), minor * sin(phi), ring * sin(theta));
    }

    // @fallback - unknown mode → sphere
    float d = length(seed);
    if (d < 1e-8) return vec3(0.0);
    return (seed / d) * min(radius, d);
}

// @@ applyFeather
// @desc - softens points near the outer radial shell (shared across layouts)
// @how - same formula the sphere path always used; distance measured from origin
vec3 applyFeather(vec3 p, float radius, float feather) {
    float distanceFromCenter = length(p);
    if (distanceFromCenter < 1e-8) {
        return p;
    }
    float featherRadius = radius - feather;
    float featherStrength = 1.0 - clamp((distanceFromCenter - featherRadius) / max(feather, 1e-6), 0.0, 1.0);
    return p * (featherStrength * (radius / distanceFromCenter - 1.0) + 1.0);
}

void main() {
    // [[particle.flow.strip]]
    // @1 - sample noise at this UV texel
    float noise = fractalNoise(vec3(fragUV * uNoiseFrequency, uNoiseOffset)) * uNoiseAmplitude;

    /*-*
    // @note - the original code
    // @what - User a single noise for X/Y, keeps the antipodal poles
    vec3 dotCenter = vec3(fragUV * uDotSpacing + uDotOffset + noise,
            (noise + 0.5 * uNoiseAmplitude) * uAmplitude * 0.4);
    /*-*/

    /*-*/
    // @note - Option B: rotating poles (song uOrbitAngle). Kept for history; active path is Option A.
    // @why - multiply by 0 so the uniform stays linked (optimizers strip truly-unused uniforms)
    mat2 R = mat2(cos(uOrbitAngle), -sin(uOrbitAngle),
                sin(uOrbitAngle),  cos(uOrbitAngle));
    /*-*/

    // [[particle.flow.seed]]
    // @2 - Option A: two independent noises → seed vec3 (strip xy + noise height z)
    // @what - Use two independent noises for X/Y instead of one scalar; removes diagonal bias
    float noiseX = fractalNoise(vec3(fragUV * uNoiseFrequency, uNoiseOffset)) * uNoiseAmplitude;
    float noiseY = fractalNoise(vec3(fragUV.yx * (uNoiseFrequency * 1.231), uNoiseOffset + 17.0)) * uNoiseAmplitude;

    vec2 baseXY = fragUV * uDotSpacing + uDotOffset + noise;
    // @note - R * 0 keeps Option B matrix + uOrbitAngle from being DCE'd; does not affect Option A
    vec2 xy = baseXY + vec2(noiseX, noiseY) + (R * vec2(0.0));

    // @what - Use the averaged noise for Z modulation
    float noiseHeight = 0.5 * (noiseX + noiseY);
    vec3 seed = vec3(xy, (noiseHeight + 0.5 * uNoiseAmplitude) * uAmplitude * 0.4);

    // [[particle.flow.layout]]
    // @3 - map seed onto sphere / disc / cylinder / torus
    vec3 dotCenter = applyLayout(seed, uLayoutMode, uSphereRadius);

    // [[particle.flow.orient]]
    // @4 - stationary pose: fixed world-axis rotations X → Y → Z (degrees set in Tune)
    // @purpose - tilt the shape even when spin speed is 0; independent of which axis spins
    // @how - uniforms already in radians from JS (deg * π/180)
    if (abs(uLayoutOrientX) > 1e-8) {
        dotCenter = rotateAxisAngle(dotCenter, 0, uLayoutOrientX);
    }
    if (abs(uLayoutOrientY) > 1e-8) {
        dotCenter = rotateAxisAngle(dotCenter, 1, uLayoutOrientY);
    }
    if (abs(uLayoutOrientZ) > 1e-8) {
        dotCenter = rotateAxisAngle(dotCenter, 2, uLayoutOrientZ);
    }

    // [[particle.flow.spin]]
    // @5 - continuous tumble around layoutSpinAxis (wall-clock angle from JS)
    // @note - happens in 3D after the stationary pose; next step still throws away Z
    if (abs(uLayoutSpin) > 1e-8) {
        dotCenter = rotateAxisAngle(dotCenter, uLayoutSpinAxis, uLayoutSpin);
    }

    // [[particle.flow.feather]]
    // @6 - soft outer shell (same control for every layoutMode)
    dotCenter = applyFeather(dotCenter, uSphereRadius, uFeather);

    // [[particle.flow.project]]
    // @7 - flip Y for screen coords, then orthographic drop: only xy is stored
    // @meaning - “3D layout + orient + spin” is real math; the canvas only ever sees the shadow
    dotCenter.y *= -1.0;
    outColor = dotCenter.xy;
}
`;

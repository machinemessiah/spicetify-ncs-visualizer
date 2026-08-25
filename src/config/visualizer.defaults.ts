// [[config.visualizer.defaults]]
// @what - Central source of truth for default visualizer ranges/values
// @how - Used to initialize `window.visualizer` and as a Reset target in controls

// [[config.visualizer.overlayBlendMode]]
// @values - final output blend mode for original + 180deg overlay
// @values - alpha_mix | additive | max | multiply | screen | overlay | soft_light | hard_light | color_dodge | color_burn | difference | exclusion | darken | lighten | linear_dodge | linear_burn | vivid_light | pin_light | hard_mix | subtract | divide
export type OverlayBlendMode =
	"alpha_mix" | "additive" | "max" | "multiply" | "screen" | "overlay" |
	"soft_light" | "hard_light" | "color_dodge" | "color_burn" | "difference" |
	"exclusion" | "darken" | "lighten" | "linear_dodge" | "linear_burn" |
	"vivid_light" | "pin_light" | "hard_mix" | "subtract" | "divide";

// [[config.visualizer.dotRadiusMode]]
// @values - actual | spherical (actual = mapped to circle, spherical = mapped to sphere)
export type DotRadiusMode = "actual" | "spherical";

// [[config.visualizer.dotShape]]
// @values - circle | triangle | square | pentagon | hexagon
// @what - particle glyph silhouette only (fragment SDF); does not change sphere layout
export type DotShape = "circle" | "triangle" | "square" | "pentagon" | "hexagon";

// @what - shader int codes for uDotShape (keep in sync with dot.ts shapeDist branches)
export const DOT_SHAPE_TO_INT: Record<DotShape, number> = {
	circle: 0,
	triangle: 1,
	square: 2,
	pentagon: 3,
	hexagon: 4,
};

export const DOT_SHAPES: DotShape[] = ["circle", "triangle", "square", "pentagon", "hexagon"];

// [[config.visualizer.layoutMode]]
// @values - sphere | disc | cylinder | torus
// @what - how the UV strip + noise seed is mapped into 3D before orthographic XY projection
export type LayoutMode = "sphere" | "disc" | "cylinder" | "torus";

export const LAYOUT_MODE_TO_INT: Record<LayoutMode, number> = {
	sphere: 0,
	disc: 1,
	cylinder: 2,
	torus: 3,
};

export const LAYOUT_MODES: LayoutMode[] = ["sphere", "disc", "cylinder", "torus"];

// [[config.visualizer.layoutSpinDirection]]
// @values - normal | reverse (sign flip on angular speed)
export type LayoutSpinDirection = "normal" | "reverse";

// [[config.visualizer.layoutSpinAxis]]
// @values - x | y | z (preset axes through layout origin; default y = vertical pole)
export type LayoutSpinAxis = "x" | "y" | "z";

export const LAYOUT_SPIN_AXIS_TO_INT: Record<LayoutSpinAxis, number> = {
	x: 0,
	y: 1,
	z: 2,
};

export const LAYOUT_SPIN_AXES: LayoutSpinAxis[] = ["x", "y", "z"];

// [[config.visualizer.hypnoDirection]]
// @values - normal | alternate (maps to window.visualizerHypnoDirection boolean at apply time)
export type HypnoDirection = "normal" | "alternate";

export const VISUALIZER_DEFAULTS = {
	// [[config.visualizer.hypnoMode]]
	// @values - whether HYPNOTOAD / hypno animation is enabled for this config
	hypnoMode: false,

	// [[config.visualizer.hypnoDirection]]
	// @values - animation direction when hypnoMode is on
	hypnoDirection: "normal" as HypnoDirection,

	// @values - refresh rate for hypno mode in Hz
	// @note - we can adjust this value and use (1000 / value) to get the animation duration in milliseconds
	hypnoModeRefreshRate: 144,

	// @values - motion blur fade factor (0 = no blur, 1 = infinite blur)
	motionBlur: 0.85,

	// [[config.visualizer.clearAfterFrames]]
	// @when - 08-07-2026
	// @what - base frame budget before a forced motion-blur wipe (ghost-trail clear)
	// @how - threshold ≈ (1 / max(0.1, motionBlur)) * clearAfterFrames; then fadeFactor briefly hits 0
	// @why - high motionBlur leaves a persistent “ghost” circle; periodic wipe avoids OLED burn-in look
	// @meaning - lower = wipe more often (shorter streaks); higher = longer trails before wipe
	// @magic - 16 was the pre-UI hard-coded value
	clearAfterFrames: 16,

	// [[config.visualizer.blurXY]]
	// @when - 08-05-2026
	// @what - spatial Gaussian blur radius as fraction of viewport (applied as coeff * viewportSize)
	// @magic - 0.01 is the pre-UI hard-coded value both axes used
	// @note - UI scale is ×1000 → [-150,150]; internal [-0.15,0.15]; negatives allowed (interesting looks)
	// @how - Tune shows integers; storage keeps coeffs; renderer multiplies by viewportSize for pixels
	blurX: 0.01,
	blurY: 0.01,

	// [[config.visualizer.blurKernelQuality]]
	// @when - 08-07-2026
	// @what - multiplier on Gaussian blur sample count after radius sizing
	// @how - shader: fragSupport = ceil(1.5 * uBlurRadius) * blurKernelQuality
	// @purpose - more taps along the blur axis = creamier bloom; fewer = cheaper/crisper
	// @magic - 15 was the pre-UI hard-coded kernel multiplier (old comment also tried //2)
	// @note - independent of blurX/blurY radius; same quality applied to both axis passes
	blurKernelQuality: 15,

	// @values - date and time of creation
	createdAt: new Date().toISOString(),

	// @values - particles per side (texture is N x N)
	// @magic - tune to your perf budget; large values scale ~O(n^2)
	dotCount: { min: 64, max: 2048 },///768 },

	// [[config.visualizer.layoutMode]]
	// @when - 08-09-2026
	// @what - 3D layout that the UV strip + noise is mapped onto before dropping Z
	// @meaning - sphere = current look; disc = flat circle; cylinder = tube side-on; torus = donut
	// @note - all modes still orthographically project to xy (no depth buffer)
	layoutMode: "sphere" as LayoutMode,

	// [[config.visualizer.layoutSpin]]
	// @when - 08-09-2026
	// @what - continuous wall-clock tumble of the 3D layout point before XY projection
	// @how - angle = timeSec * layoutSpinSpeed * ±2π (reverse flips sign)
	// @purpose - make the sphere/cylinder/torus slowly turn without rotating the canvas
	// @meaning - speed is revolutions per second; 0 = frozen
	layoutSpinSpeed: 0,
	layoutSpinDirection: "normal" as LayoutSpinDirection,
	// @what - which world axis to spin around (y = vertical pole / “planet on its axis”)
	layoutSpinAxis: "y" as LayoutSpinAxis,

	// [[config.visualizer.layoutOrient]]
	// @when - 08-11-2026
	// @what - stationary pose of the layout in degrees around world X/Y/Z (applied before continuous spin)
	// @how - shader rotates X → Y → Z; JS converts degrees → radians for uniforms
	// @purpose - tilt/pose the shape even when layoutSpinSpeed is 0; spin still tumbles on top
	// @meaning - 0,0,0 = current default look; each axis is [0, 360]
	layoutOrientX: 0,
	layoutOrientY: 0,
	layoutOrientZ: 0,

	// @values - layout radial scale (historically “sphere” radius; shared by all layoutModes)
	// @note - Tune UI labels this "Radius"
	sphereRadius: { min: 0.65, max: 1, mid: 0.2, gate: 0.05 },

	// @values - noise displacement amplitude
	// @!note - this effectively makes them static (same value for any amplitude)
	noiseAmplitude: { min: 0.3, max: 0.3 },

	// @values - base noise frequency
	noiseFrequency: { min: 0.4, max: 15 },

	// [[config.visualizer.noiseOffsetScale]]
	// @when - 08-07-2026
	// @what - how fast the 3D noise volume scrolls as time + amplitude-energy advance
	// @how - uNoiseOffset = (0.5 * progressSec + amplitudeIntegral) * noiseOffsetScale
	// @purpose - scales “how far” the noise field moves for a given amount of song time/energy
	// @meaning - larger = busier/warpier particle drift; negative = reverse scroll direction
	// @magic - 0.75 == old hard-coded `75 * 0.01`
	// @note - UI scale is ×100 → [-500,500]; storage keeps coeff [-5,5]
	noiseOffsetScale: 0.75,

	// [[config.visualizer.amplitudeWindow]]
	// @when - 08-07-2026
	// @what - seconds of audio loudness averaged around “now” before driving sphere/dots
	// @how - passed as windowSize to sampleAmplitudeMovingAverage(amplitudeCurve, progress, window)
	// @purpose - temporal smoothing of loudness so geometry doesn’t twitch on every tiny spike
	// @meaning - smaller = snappier reaction; larger = smoother/laggier; 0 = raw curve sample (no MA)
	// @magic - 0.05 was the pre-UI hard-coded window (50ms)
	// @note - UI scale is ×1000 → [0,2000]; storage keeps seconds [0,2]
	amplitudeWindow: 0.05,

	// @values - edge feathering strength
	feather: { min: 0.1, max: 2, scalar: 3 },

	// [[config.visualizer.dotRadiusMode]]
	// @values - actual | spherical (actual = mapped to circle, spherical = mapped to sphere)
	dotRadiusMode: "spherical" as DotRadiusMode,

	// [[config.visualizer.dotShape]]
	// @when - 08-07-2026
	// @what - particle glyph silhouette drawn inside each instanced quad
	// @how - fragment SDF in dot.ts; soft edge still uses fragDotRadiusPX
	// @purpose - swap circle ↔ polygons without touching radius/count/spacing/blur/sphere layout
	// @meaning - circle = current look; others fill a different mask inside the same quad
	// @note - upright in local UV; no per-particle rotation in v1
	dotShape: "circle" as DotShape,

	// @values - dot radius mapping + optional clamp multipliers used in shader inputs
	// @note - multipliers are consumed in `NCSVisualizer.tsx` when calculating `uDotRadius`
	dotRadius: { min: 0.9, max: 1, multiplierLow: 0.75, multiplierHigh: 0.25 },

	// @values - dot spacing on the 1D strip before spherical wrap
	dotSpacing: { min: 0.9, max: 1 },

	// @values - offset applied to the strip to avoid center dot
	dotOffset: { min: -0.9 / 2, max: 0 },

	// [[config.visualizer.overlayBlendMode]]
	// @values - final output blend mode for original + 180deg overlay
	overlayBlendMode: "additive" as OverlayBlendMode,

	// [[config.visualizer.overlayCopies]]
	// @what - number of rotated copies sampled in output-composite pass
	// @why - enables N-way rotational overlays (2, 3, 4, ...)
	overlaySampleCount: 2,

	// [[config.visualizer.overlayOffset]]
	// @what - global angle offset (degrees) for evenly spaced overlays
	overlayAngleOffsetDeg: 0,

	// [[config.visualizer.overlayAngles]]
	// @what - optional explicit angle list override
	// @how - when non-empty, renderer uses this list instead of generated count/offset spacing
	overlayAnglesDeg: [] as number[],
};

// [[@types.visualizer.global]]
// @important - Consumers should import this when needing defaults or for Reset behavior



// [[config.visualizer.defaults]]
// @what - Central source of truth for default visualizer ranges/values
// @how - Used to initialize `window.visualizer` and as a Reset target in controls

export const VISUALIZER_DEFAULTS = {
	// @values - edge feathering strength
	feather: { min: 0.1, max: 2, scalar: 3 },

	// @values - noise displacement amplitude
	// @!note - this effectively makes them static (same value for any amplitude)
	noiseAmplitude: { min: 0.3, max: 0.3 },

	// @values - base noise frequency
	noiseFrequency: { min: 0.4, max: 15 },

	// @values - sphere radius range
	sphereRadius: { min: 0.65, max: 1, mid: 0.2, gate: 0.05 },

	// @values - dot radius mapping + optional clamp multipliers used in shader inputs
	// @note - multipliers are consumed in `NCSVisualizer.tsx` when calculating `uDotRadius`
	dotRadius: { min: 0.9, max: 1, multiplierLow: 0.75, multiplierHigh: 0.25 },

	// @values - dot spacing on the 1D strip before spherical wrap
	dotSpacing: { min: 0.9, max: 1 },

	// @values - offset applied to the strip to avoid center dot
	dotOffset: { min: -0.9 / 2, max: 0 },

	// @values - particles per side (texture is N x N)
	// @magic - tune to your perf budget; large values scale ~O(n^2)
	dotCount: { min: 64, max: 2048 },///768 },

	// @values - motion blur fade factor (0 = no blur, 1 = infinite blur)
	motionBlur: 0.85,
};

// [[@types.visualizer.global]]
// @important - Consumers should import this when needing defaults or for Reset behavior



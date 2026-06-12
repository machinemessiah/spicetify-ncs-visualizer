// [[types.visualizer.global]] 
// @what - Global typing for `window.visualizer` with nested ranges
// @how - Augments `Window` so the editor can navigate/validate `window.visualizer.*`

// @what - Defer the runtime shape to the defaults object type for better navigation
// @how - Using typeof import(...) makes ctrl+click on properties jump to values file without runtime import

declare global {
	interface Window {
		visualizer: typeof import("../config/visualizer.defaults").VISUALIZER_DEFAULTS;
	}
}

// @what - Simple min/max pair
export type VisualizerRange = {
	min: number;
	max: number;
};

// @what - Range used by dot radius calc with optional clamp factors
export interface VisualizerDotRadius extends VisualizerRange {
	// @optional - used in some calculations
	multiplierLow?: number;
	multiplierHigh?: number;
}

// @what - Shape of the visualizer config object stored on window
export interface VisualizerConfig {
	feather: VisualizerRange;
	noiseAmplitude: VisualizerRange;
	noiseFrequency: VisualizerRange;
	sphereRadius: VisualizerRange;
	dotRadius: VisualizerDotRadius; // supports optional multipliers
	dotSpacing: VisualizerRange;
	dotOffset: VisualizerRange;
	dotCount: VisualizerRange;
	motionBlur: number;
}

export { };
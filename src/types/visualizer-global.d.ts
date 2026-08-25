// [[types.visualizer.global]] 
// @what - Global typing for `window.visualizer` with nested ranges
// @how - Augments `Window` so the editor can navigate/validate `window.visualizer.*`

// @what - Defer the runtime shape to the defaults object type for better navigation
// @how - Using typeof import(...) makes ctrl+click on properties jump to values file without runtime import

// [[types.visualizer.global.mmPalette]]
// @when - 06-19-2026
// @what - Runtime shape for global palettes injected by dynamic color logic
// @why - Real shape is a name->palette map (e.g. `fetched`, `stolen`) rather than an array of objects
type MmPaletteMap = Record<string, [number, number, number][]>;

// [[@config.visualizer.overlayBlendMode]]
// @reliantOn - `OverlayBlendMode` is exported from `visualizer.defaults.ts`
import type { OverlayBlendMode } from "../config/visualizer.defaults";
import type { Icon } from "../types/spicetify";

declare global {
	interface Window {
		visualizer: typeof import("../config/visualizer.defaults").VISUALIZER_DEFAULTS;
		// [[@config.configStore.currentConfig]]
		visualizerCurrentConfig: {
			basedOn: string | null;
			values: typeof import("../config/visualizer.defaults").VISUALIZER_DEFAULTS;
		};
		visualizerLastOverlayBlendMode: OverlayBlendMode;
		visualizerHypnoMode: boolean;
		visualizerHypnoDirection: boolean;
		visualizerName: string;
		visualizerUseSongPalette: boolean; // @default - false
		// [[@types.visualizer.global.mmPalette]]
		mm: {
			_PALETTES?: MmPaletteMap;
			refreshRate: {
				ms: number;
				rawMS: number;
				direction?: "normal" | "alternate";
				directionAsBoolean: boolean;
			};
		};
		Utilities: {
			addCSSRule(id: string, css: string, actual?: boolean): void;
		};
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
	// @what - particle glyph silhouette (fragment SDF); circle|triangle|square|pentagon|hexagon
	dotShape: import("../config/visualizer.defaults").DotShape;
	// @what - 3D layout map before orthographic XY drop
	layoutMode: import("../config/visualizer.defaults").LayoutMode;
	// @what - layout tumble speed in revolutions per second
	layoutSpinSpeed: number;
	layoutSpinDirection: import("../config/visualizer.defaults").LayoutSpinDirection;
	layoutSpinAxis: import("../config/visualizer.defaults").LayoutSpinAxis;
	// @what - stationary pose angles in degrees [0,360] around world X/Y/Z (before layoutSpin)
	layoutOrientX: number;
	layoutOrientY: number;
	layoutOrientZ: number;
	motionBlur: number;
	// @what - base frame budget for forced motion-blur wipe (ghost clear)
	clearAfterFrames: number;
	// @what - spatial Gaussian blur coeffs (UI ×1000); applied as coeff * viewportSize
	blurX: number;
	blurY: number;
	// @what - Gaussian kernel tap multiplier (blur shader fragSupport)
	blurKernelQuality: number;
	// @what - noise scroll scale (UI ×100); multiplies time+energy → uNoiseOffset
	noiseOffsetScale: number;
	// @what - loudness MA window in seconds (UI ×1000)
	amplitudeWindow: number;
	overlayBlendMode: OverlayBlendMode;
	overlaySampleCount: number;
	overlayAngleOffsetDeg: number;
	overlayAnglesDeg: number[];
}

export { };
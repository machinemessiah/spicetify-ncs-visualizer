import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import AnimatedCanvas from "../AnimatedCanvas";
import {
	sampleAmplitudeMovingAverage,
	decibelsToAmplitude,
	mapLinear,
	mapAlongSegments,
	smoothstep,
	mapWithSilenceGate,
	integrateLinearSegment,
	sampleAccumulatedIntegral,
	binarySearchIndex,
	map,
	mapPiecewise,
	rgbToHsl,
	hslToRgb
} from "../../utils";
import {
	vertexShader as PARTICLE_VERT_SHADER,
	fragmentShader as PARTICLE_FRAG_SHADER
} from "../../shaders/ncs-visualizer/particle";
import { vertexShader as DOT_VERT_SHADER, fragmentShader as DOT_FRAG_SHADER } from "../../shaders/ncs-visualizer/dot";
import { vertexShader as BLUR_VERT_SHADER, fragmentShader as BLUR_FRAG_SHADER } from "../../shaders/ncs-visualizer/blur";
import { vertexShader as FADE_VERT_SHADER, fragmentShader as FADE_FRAG_SHADER } from "../../shaders/ncs-visualizer/fade";
import {
	vertexShader as FINALIZE_VERT_SHADER,
	fragmentShader as FINALIZE_FRAG_SHADER
} from "../../shaders/ncs-visualizer/finalize";
import {
	vertexShader as OUTPUT_COMPOSITE_VERT_SHADER,
	fragmentShader as OUTPUT_COMPOSITE_FRAG_SHADER
} from "../../shaders/ncs-visualizer/output-composite";
import { ErrorHandlerContext, ErrorRecovery } from "../../error";
import {
	VISUALIZER_DEFAULTS,
	OverlayBlendMode,
	DOT_SHAPE_TO_INT,
	LAYOUT_MODE_TO_INT,
	LAYOUT_SPIN_AXIS_TO_INT,
	type DotShape,
	type LayoutMode,
	type LayoutSpinAxis,
} from "../../config/visualizer.defaults";
// [[@config.configStore]]
import { getConfigs, hydrateVisualizerSession, syncHypnoGlobalsFromVisualizer, persistCurrentConfig, normalizeVisualizerValues } from "../../config/configStore";
import { RendererProps } from "../../app";
///import { VisualizerConfig, VisualizerRange, VisualizerDotRadius } from "../../types/visualizer-global";

// @what - Get a value from localStorage, or set it to a default value if it doesn't exist
const localStorageGetAndSetDefault = (key: string, defaultValue: any) => {
	const value = localStorage.getItem(key);
	if (value === null) {
		if (typeof defaultValue === "object" || Array.isArray(defaultValue) || typeof defaultValue === "function") {
			localStorage.setItem(key, JSON.stringify(defaultValue));
			return defaultValue;
		}
		if (typeof defaultValue === "boolean") {
			localStorage.setItem(key, defaultValue ? "true" : "false");
			return defaultValue;
		}
		if (typeof defaultValue === "number") {
			localStorage.setItem(key, defaultValue.toString());
			return defaultValue;
		}
		if (typeof defaultValue === "string") {
			localStorage.setItem(key, defaultValue);
			return defaultValue;
		}
		throw new Error(`[localStorage.getOrSet] Unsupported default value type: ${typeof defaultValue}`);
	}
	return value;
}

// [[ncs.palette.cssRgb]]
// @what - Load 12 colors from CSS vars that contain raw "r, g, b" triples
function getCssVarRgbTuple(varName: string): [number, number, number] | null {
	// @how - Read "--mm-colorGroupName-XX-rgb" -> "r, g, b"
	const raw = getComputedStyle(document.documentElement).getPropertyValue(varName);
	if (!raw) return null;
	const parts = raw.split(",").map(s => parseFloat(s.trim()));
	if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
	return [parts[0], parts[1], parts[2]];
}
const getRGBValues = (): [number, number, number][] => {
	let indicies: number[] = [];
	const spectrum = ["gpx", "g3c"].sort(() => Math.random() - 0.5)[0] as "gpx" | "g3c";
	const sizeOfSpectrum = spectrum === "gpx" ? 128 : 64;
	while (indicies.length < 12) {
		const index = Math.floor(Math.random() * sizeOfSpectrum);
		if (!indicies.includes(index)) {
			indicies.push(index);
		}
	}
	// @why - sorts the colors so they are in "rainbow" order
	indicies.sort((a, b) => a - b);
	const rgbValues = indicies.map(index => getCssVarRgbTuple(`--mm-${spectrum}-${index}-rgb`) ?? [0, 0, 0]) as [number, number, number][];
	console.white(`[NCSVisualizer colors] ${rgbValues.map(rgb => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`).join("  ")}`);
	return rgbValues;
};
/*-*/
// @values - Pick 12 evenly spaced colors from your 32 rainbow (tweak order to taste)
const PITCH_RGB_VARS = [
	"--mm-gpc-1-rgb",
	"--mm-gpc-4-rgb",
	"--mm-gpc-6-rgb",
	"--mm-gpc-8-rgb",
	"--mm-gpc-10-rgb",
	"--mm-gpc-12-rgb",
	"--mm-gpc-16-rgb",
	"--mm-gpc-19-rgb",
	"--mm-gpc-22-rgb",
	"--mm-gpc-25-rgb",
	"--mm-gpc-28-rgb",
	"--mm-gpc-31-rgb"
];
/*-*/

function getPalettePitchRgbVars(useSongPalette: boolean): [number, number, number][] | false {
	if (!useSongPalette) return false;
	// @when - 06-19-2026
	// @what - Normalize runtime-injected palette map into a flat RGB tuple list
	// @why - `window.mm._PALETTES` is an object map (`{ fetched: [...], stolen: [...] }`), not an array
	// [[ncs.palette.runtimeMapShape]]
	const palettes = window.mm?._PALETTES;
	console.warn(`[NCSVisualizer] Palettes`, palettes);
	if (!palettes || typeof palettes !== "object") return false;

	const vars: [number, number, number][] = [];
	Object.values(palettes).forEach((palette) => {
		if (!Array.isArray(palette)) return;
		palette.forEach((rgb) => {
			if (!Array.isArray(rgb) || rgb.length !== 3) return;
			const [r, g, b] = rgb;
			if ([r, g, b].some(value => Number.isNaN(Number(value)))) return;
			vars.push([Number(r), Number(g), Number(b)]);
		});
	});
	console.warn(`[NCSVisualizer] palette pitch RGB vars`, vars);
	return vars.length > 0 ? vars : false;
}

// @fallback - 12 static RGBs (only used if some CSS vars not found)
const DEFAULT_PITCH_RGB: [number, number, number][] = [
	[255, 82, 96], [255, 126, 41], [255, 196, 0], [254, 217, 15],
	[183, 241, 9], [51, 255, 0], [0, 255, 170], [0, 184, 230],
	[0, 162, 255], [180, 106, 254], [255, 0, 195], [255, 77, 136]
];

// [[ncs.visualizer.defaults.init]]
// [[@types.visualizer.global]]
// [[@config.configStore]]
// [[@config.configStore.currentConfig]]
// @when - 07-26-2026
// @what - Initialize global `window.visualizer` from live currentConfig (preferred) or last named config
// @how - `hydrateVisualizerSession()` runs the hypno CONFIGS migration, then restores the session
window.visualizerLastOverlayBlendMode = localStorage.getItem("mm.visualizer.lastOverlayBlendMode") as OverlayBlendMode || "additive";
if (!window.visualizer) {
	hydrateVisualizerSession();
	const storedConfigs = getConfigs();
	console.black("[NCSVisualizer] Stored configs");
	console.g.white(storedConfigs);
	console.groupEnd();
	const basedOn = window.visualizerCurrentConfig?.basedOn;
	if (basedOn) {
		console.deepskyblue(`[NCSVisualizer] Restored currentConfig based on "${basedOn}"`, window.visualizer);
	} else {
		console.palevioletred("[NCSVisualizer] Restored unsaved currentConfig / defaults", window.visualizer);
	}
} else {
	// @how - still sync hypno globals if visualizer was somehow pre-seeded
	window.visualizer = normalizeVisualizerValues(window.visualizer);
	syncHypnoGlobalsFromVisualizer(window.visualizer);
	persistCurrentConfig();
}
if (!window.visualizer?.overlayBlendMode) {
	window.visualizer.overlayBlendMode = window.visualizerLastOverlayBlendMode;
	localStorage.setItem("mm.visualizer.lastOverlayBlendMode", window.visualizer.overlayBlendMode);
	console.warn(`[NCSVisualizer] Using last used (global) overlay blend mode "${window.visualizer.overlayBlendMode}"`);
}
// @what - Backward compatibility for configs saved before multi-copy overlay fields existed
if (typeof window.visualizer?.overlaySampleCount !== "number") {
	window.visualizer.overlaySampleCount = VISUALIZER_DEFAULTS.overlaySampleCount;
}
if (typeof window.visualizer?.overlayAngleOffsetDeg !== "number") {
	window.visualizer.overlayAngleOffsetDeg = VISUALIZER_DEFAULTS.overlayAngleOffsetDeg;
}
if (!Array.isArray(window.visualizer?.overlayAnglesDeg)) {
	window.visualizer.overlayAnglesDeg = [...VISUALIZER_DEFAULTS.overlayAnglesDeg];
}
// @what - Backward compatibility for configs saved before dotRadiusMode existed
if (window.visualizer?.dotRadiusMode !== "actual" && window.visualizer?.dotRadiusMode !== "spherical") {
	window.visualizer.dotRadiusMode = VISUALIZER_DEFAULTS.dotRadiusMode;
}
// @what - Backward compatibility for configs saved before dotShape existed
if (
	window.visualizer?.dotShape !== "circle" &&
	window.visualizer?.dotShape !== "triangle" &&
	window.visualizer?.dotShape !== "square" &&
	window.visualizer?.dotShape !== "pentagon" &&
	window.visualizer?.dotShape !== "hexagon"
) {
	window.visualizer.dotShape = VISUALIZER_DEFAULTS.dotShape;
}
// @what - Backward compatibility for configs saved before layoutMode / layoutSpin existed
if (
	window.visualizer?.layoutMode !== "sphere" &&
	window.visualizer?.layoutMode !== "disc" &&
	window.visualizer?.layoutMode !== "cylinder" &&
	window.visualizer?.layoutMode !== "torus"
) {
	window.visualizer.layoutMode = VISUALIZER_DEFAULTS.layoutMode;
}
if (typeof window.visualizer?.layoutSpinSpeed !== "number") {
	window.visualizer.layoutSpinSpeed = VISUALIZER_DEFAULTS.layoutSpinSpeed;
}
if (window.visualizer?.layoutSpinDirection !== "normal" && window.visualizer?.layoutSpinDirection !== "reverse") {
	window.visualizer.layoutSpinDirection = VISUALIZER_DEFAULTS.layoutSpinDirection;
}
if (window.visualizer?.layoutSpinAxis !== "x" && window.visualizer?.layoutSpinAxis !== "y" && window.visualizer?.layoutSpinAxis !== "z") {
	window.visualizer.layoutSpinAxis = VISUALIZER_DEFAULTS.layoutSpinAxis;
}
// @what - Backward compatibility for configs saved before layoutOrient* existed
if (typeof window.visualizer?.layoutOrientX !== "number") {
	window.visualizer.layoutOrientX = VISUALIZER_DEFAULTS.layoutOrientX;
}
if (typeof window.visualizer?.layoutOrientY !== "number") {
	window.visualizer.layoutOrientY = VISUALIZER_DEFAULTS.layoutOrientY;
}
if (typeof window.visualizer?.layoutOrientZ !== "number") {
	window.visualizer.layoutOrientZ = VISUALIZER_DEFAULTS.layoutOrientZ;
}
if (typeof window.visualizer?.hypnoMode !== "boolean") {
	window.visualizer.hypnoMode = !!window.visualizerHypnoMode;
}
if (window.visualizer?.hypnoDirection !== "normal" && window.visualizer?.hypnoDirection !== "alternate") {
	window.visualizer.hypnoDirection = window.visualizerHypnoDirection ? "normal" : "alternate";
}

type CanvasData = {
	themeColor: Spicetify.Color;
	seed: number;
	amplitudeCurve: CurveEntry[];
	// @what - time → mixed color [r, g, b]
	mixedColorCurve: { x: number; r: number; g: number; b: number }[];
};

// [[ncs.overlayBlendMode.shaderMap]]
// @values - map runtime blend mode strings to shader enum ints
// @reliantOn - `OverlayBlendMode` exported from `visualizer.defaults.ts`
const OVERLAY_BLEND_MODE_SHADER_MAP: Record<OverlayBlendMode, number> = {
	alpha_mix: 0,
	additive: 1,
	max: 2,
	multiply: 3,
	screen: 4,
	overlay: 5,
	soft_light: 6,
	hard_light: 7,
	color_dodge: 8,
	color_burn: 9,
	difference: 10,
	exclusion: 11,
	darken: 12,
	lighten: 13,
	linear_dodge: 14,
	linear_burn: 15,
	vivid_light: 16,
	pin_light: 17,
	hard_mix: 18,
	subtract: 19,
	divide: 20
};

// @value - safe fallback for old configs that don't include overlayBlendMode
const DEFAULT_OVERLAY_BLEND_MODE: OverlayBlendMode = window.visualizerLastOverlayBlendMode || "additive";
const DEFAULT_ALPHA_MIX_FACTOR = 0.5;
// @what - hard cap used by both shader and JS uniform upload path
const OUTPUT_COMPOSITE_MAX_OVERLAY_SAMPLES = 12;

// [[ncs.overlay.count.clamp]]
// @what - clamp + normalize runtime overlay sample count to safe integer range
function ncsClampOverlaySampleCount(rawCount: unknown): number {
	const numericCount = Number(rawCount);
	if (!Number.isFinite(numericCount)) return VISUALIZER_DEFAULTS.overlaySampleCount;
	return Math.max(1, Math.min(OUTPUT_COMPOSITE_MAX_OVERLAY_SAMPLES, Math.round(numericCount)));
}

// [[ncs.overlay.angles.normalize]]
// @what - sanitize user-provided explicit angle list
// @how - keep only finite values and cap to shader limit
function ncsNormalizeOverlayAnglesDeg(rawAngles: unknown): number[] {
	if (!Array.isArray(rawAngles)) return [];
	return rawAngles
		.map(value => Number(value))
		.filter(value => Number.isFinite(value))
		.slice(0, OUTPUT_COMPOSITE_MAX_OVERLAY_SAMPLES);
}

// [[ncs.overlay.angles.resolve]]
// @what - resolve final angle list using explicit list override or evenly spaced generation
function ncsResolveOverlayAnglesDeg(): number[] {
	const explicitAngles = ncsNormalizeOverlayAnglesDeg(window.visualizer?.overlayAnglesDeg);
	if (explicitAngles.length > 0) return explicitAngles;

	const overlayCount = ncsClampOverlaySampleCount(window.visualizer?.overlaySampleCount);
	const offsetDeg = Number.isFinite(Number(window.visualizer?.overlayAngleOffsetDeg))
		? Number(window.visualizer?.overlayAngleOffsetDeg)
		: VISUALIZER_DEFAULTS.overlayAngleOffsetDeg;
	const stepDeg = 360 / overlayCount;
	return Array.from({ length: overlayCount }, (_, index) => offsetDeg + index * stepDeg);
}

// [[ncs.overlay.rotCS.build]]
// @what - build packed [cos, sin, cos, sin, ...] array for shader upload
function ncsBuildOverlayRotCSFlat(anglesDeg: number[]): Float32Array {
	const packed = new Float32Array(OUTPUT_COMPOSITE_MAX_OVERLAY_SAMPLES * 2);
	for (let i = 0; i < Math.min(anglesDeg.length, OUTPUT_COMPOSITE_MAX_OVERLAY_SAMPLES); i++) {
		const radians = anglesDeg[i] * Math.PI / 180;
		packed[i * 2] = Math.cos(radians);
		packed[i * 2 + 1] = Math.sin(radians);
	}
	return packed;
}

type RendererState =
	| {
			isError: true;
	}
	| {
			isError: false;
			particleShader: WebGLProgram;
			dotShader: WebGLProgram;
			blurShader: WebGLProgram;
			finalizeShader: WebGLProgram;
			fadeShader: WebGLProgram;
		outputCompositeShader: WebGLProgram;
			viewportSize: number;
			particleTextureSize: number;

			inPositionLoc: number;
			inPositionLocDot: number;
			inPositionLocBlur: number;
			inPositionLocFinalize: number;
			inPositionLocFade: number;
		inPositionLocOutputComposite: number;

			uNoiseOffsetLoc: WebGLUniformLocation;
			uAmplitudeLoc: WebGLUniformLocation;
			uSeedLoc: WebGLUniformLocation;
			uDotSpacingLoc: WebGLUniformLocation;
			uDotOffsetLoc: WebGLUniformLocation;
			uSphereRadiusLoc: WebGLUniformLocation;
			uFeatherLoc: WebGLUniformLocation;
			uNoiseFrequencyLoc: WebGLUniformLocation;
			uNoiseAmplitudeLoc: WebGLUniformLocation;

			// @what - rotation of the XY frame; moves poles along edge
			// @value - rotation angle uniform
			uOrbitAngleLoc: WebGLUniformLocation;

		// @what - layoutMode + continuous layoutSpin tumble + stationary orient
		uLayoutModeLoc: WebGLUniformLocation;
		uLayoutSpinLoc: WebGLUniformLocation;
		uLayoutSpinAxisLoc: WebGLUniformLocation;
		uLayoutOrientXLoc: WebGLUniformLocation;
		uLayoutOrientYLoc: WebGLUniformLocation;
		uLayoutOrientZLoc: WebGLUniformLocation;

			uDotCountLoc: WebGLUniformLocation;
			uDotRadiusLoc: WebGLUniformLocation;
			uDotRadiusPXLoc: WebGLUniformLocation;
		uDotShapeLoc: WebGLUniformLocation;
			uParticleTextureLoc: WebGLUniformLocation;

			uBlurRadiusLoc: WebGLUniformLocation;
		uBlurKernelQualityLoc: WebGLUniformLocation;
			uBlurDirectionLoc: WebGLUniformLocation;
			uBlurInputTextureLoc: WebGLUniformLocation;

			uOutputColorLoc: WebGLUniformLocation;
			uBlurredTextureLoc: WebGLUniformLocation;
			uOriginalTextureLoc: WebGLUniformLocation;

			uFadeInputTextureLoc: WebGLUniformLocation;
			uFadeFactorLoc: WebGLUniformLocation;
		uOutputCompositeInputTextureLoc: WebGLUniformLocation;
		uOutputCompositeBlendModeLoc: WebGLUniformLocation;
		uOutputCompositeAlphaMixFactorLoc: WebGLUniformLocation;
		uOutputCompositeSampleCountLoc: WebGLUniformLocation;
		uOutputCompositeRotCSLoc: WebGLUniformLocation;

			// @what - rotation uniform for final pass
			uRotationLoc: WebGLUniformLocation;

			quadBuffer: WebGLBuffer;

			particleFramebuffer: WebGLFramebuffer;
			particleTexture: WebGLTexture;
			dotFramebuffer: WebGLFramebuffer;
			dotTexture: WebGLTexture;
			blurXFramebuffer: WebGLFramebuffer;
			blurXTexture: WebGLTexture;
			blurYFramebuffer: WebGLFramebuffer;
			blurYTexture: WebGLTexture;
			
			accumFramebufferA: WebGLFramebuffer;
			accumTextureA: WebGLTexture;
			accumFramebufferB: WebGLFramebuffer;
			accumTextureB: WebGLTexture;
			
			useAccumA: boolean;

			lastT: number;
			rotAngle: number;
	};

export default function NCSVisualizer(props: RendererProps) {
	const onError = useContext(ErrorHandlerContext);
	const [paletteVersion, setPaletteVersion] = useState(0);
	const [spectrumVersion, setSpectrumVersion] = useState(0);

	// @when - 06-19-2026
	// @what - Recompute pitch palette whenever external palette extraction publishes updates
	// @why - Runtime palettes are often populated AFTER mount; useMemo([]) would otherwise stay stale
	// [[@ncs.palette.runtimeMapShape]]
	useEffect(() => {
		const onPaletteChange = () => {
			setPaletteVersion(v => v + 1);
		};
		window.addEventListener("dynamic-palette-change", onPaletteChange);
		return () => {
			window.removeEventListener("dynamic-palette-change", onPaletteChange);
		};
	}, []);
	useEffect(() => {
		const onSpectrumChange = () => {
			console.sienna("[NCSVisualizer] songchange, spectrum changed");
			setSpectrumVersion(v => v + 1);
		};
		Spicetify.Player.addEventListener(`songchange`, onSpectrumChange);
		return () => {
			Spicetify.Player.removeEventListener(`songchange`, onSpectrumChange);
		};
	}, []);

	// [[ncs.amplitudeCurve]]
	// @what - Build an amplitude curve (time → loudness in amplitude space) from segment data
	// @why - Used to drive particle motion/noise and the sphere radius over time
	// @how - Linear segments in time, with an accumulated integral to sample smooth “energy” over time
	const amplitudeCurve = useMemo(() => {
		if (!props.audioAnalysis) return [{ x: 0, y: 0 }];

		const segments = props.audioAnalysis.segments;

		// @info - For segments with a `loudness_max_time`, record a point at start and at the peak.
		const amplitudeCurve: CurveEntry[] = segments.flatMap(segment =>
			segment.loudness_max_time
				? [
					{ x: segment.start, y: decibelsToAmplitude(segment.loudness_start) },
					{ x: segment.start + segment.loudness_max_time, y: decibelsToAmplitude(segment.loudness_max) }
				]
				: [{ x: segment.start, y: decibelsToAmplitude(segment.loudness_start) }]
		);

		// @how - Precompute accumulated integrals to allow fast “energy” sampling
		if (segments.length) {
			amplitudeCurve[0].accumulatedIntegral = 0;
			for (let i = 1; i < amplitudeCurve.length; i++) {
				const prev = amplitudeCurve[i - 1];
				const curr = amplitudeCurve[i];
				curr.accumulatedIntegral = (prev.accumulatedIntegral ?? 0) + integrateLinearSegment(prev, curr);
			}

			// @note - Close curve with the segment end loudness for the last point
			const lastSegment = segments[segments.length - 1];
			amplitudeCurve.push({
				x: lastSegment.start + lastSegment.duration,
				y: decibelsToAmplitude(lastSegment.loudness_end)
			});
		}

		return amplitudeCurve;
	}, [props.audioAnalysis]);

	// [[ncs.pitchPalette]]
	// @what - 12-color palette sourced from CSS vars (raw rgb triples)
	const pitchPalette = useMemo(() => {
		// @purpose - try to use the song palette colors if available
		const paletteRGBs = getPalettePitchRgbVars(props.useSongPalette);
		if (paletteRGBs !== false) {
			return paletteRGBs;
		}
		const vals = getRGBValues();
		return vals;
	}, [paletteVersion, props.useSongPalette, spectrumVersion]);

	// [[ncs.mixedColorCurve]]
	// @what - time → mixed color [r, g, b]
	const mixedColorCurve = useMemo(() => {
		if (!props.audioAnalysis) return [{ x: 0, r: 0, g: 0, b: 0 }];
		const segments = props.audioAnalysis.segments;
		const curve = segments.map(seg => {
			let totalWeight = 0;
			let sumSin = 0;
			let sumCos = 0;
			let sumS = 0;
			
			for (let i = 0; i < 12; i++) {
				// @how - raise pitch to a power to emphasize dominant pitches and keep colors vibrant
				const weight = Math.pow(seg.pitches[i], 3);
				totalWeight += weight;
				
				const [pr, pg, pb] = pitchPalette[i];
				const [h, s, l] = rgbToHsl(pr, pg, pb);
				
				// @how - circular mean for hue
				const angle = h * Math.PI * 2;
				sumSin += Math.sin(angle) * weight;
				sumCos += Math.cos(angle) * weight;
				sumS += s * weight;
			}
			
			let r = 0, g = 0, b = 0;
			if (totalWeight > 0) {
				const avgS = sumS / totalWeight;
				let avgH = Math.atan2(sumSin / totalWeight, sumCos / totalWeight) / (Math.PI * 2);
				if (avgH < 0) avgH += 1;
				
				// @how - lock lightness to 0.5 for maximum vibrancy
				[r, g, b] = hslToRgb(avgH, avgS, 0.5);
			}
			
			return { x: seg.start, r, g, b };
		});
		
		if (segments.length) {
			const last = segments[segments.length - 1];
			const lastColor = curve[curve.length - 1];
			curve.push({ x: last.start + last.duration, r: lastColor.r, g: lastColor.g, b: lastColor.b });
		}
		return curve;
	}, [props.audioAnalysis, pitchPalette]);

	const seed = props.audioAnalysis?.meta.timestamp ?? 0;
	const duration = props.audioAnalysis?.track.duration ?? 0;

	// [[ncs.onInit.pipelineSetup]]
	// @what - Initialize GL programs, uniforms, buffers and offscreen framebuffers for the pipeline
	// @how - 4 passes: particle positions → dot render → blur X → blur Y → composite
	const onInit = useCallback((gl: WebGL2RenderingContext | null): RendererState => {
		if (!gl) {
			onError("Error: WebGL2 is not supported", ErrorRecovery.NONE);
			return { isError: true };
		}

		// @important - Need float render targets for particle positions
		if (!gl.getExtension("EXT_color_buffer_float")) {
			onError(`Error: Rendering to floating-point textures is not supported`, ErrorRecovery.NONE);
			return { isError: true };
		}

		// @? - Helper: compile/link shader programs with error reporting
		const createShader = (type: number, source: string, name: string) => {
			const shader = gl.createShader(type)!;
			gl.shaderSource(shader, source);
			gl.compileShader(shader);

			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
				const msg = `Error: Failed to compile '${name}' shader`;
				const log = gl.getShaderInfoLog(shader);
				console.error(`[Visualizer] ${msg}`, log);

				onError(msg, ErrorRecovery.NONE);
				return null;
			}

			return shader;
		};

		gl.canvas.style.setProperty('--visualizer-rotation', `${[0, 90, 180, 270, 360][Math.ceil(Math.random() * 4)]}deg`);
		if (window.visualizerHypnoMode) {
			(gl.canvas as HTMLCanvasElement).classList.add("HYPNOTOAD");
		}

		// @? - Helper: compile/link shader programs with error reporting
		const createProgram = (vertShader: WebGLShader, fragShader: WebGLShader, name: string) => {
			const shader = gl.createProgram()!;
			gl.attachShader(shader, vertShader);
			gl.attachShader(shader, fragShader);
			gl.linkProgram(shader);

			if (!gl.getProgramParameter(shader, gl.LINK_STATUS) && !gl.isContextLost()) {
				const msg = `Error: Failed to link '${name}' shader`;
				const log = gl.getProgramInfoLog(shader);
				console.error(`[Visualizer] ${msg}`, log);

				onError(msg, ErrorRecovery.NONE);
				return null;
			}

			return shader;
		};

		// @what - Create a framebuffer + texture pair with specified filtering
		const createFramebuffer = (filter: number) => {
			const framebuffer = gl.createFramebuffer()!;
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

			const texture = gl.createTexture()!;
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

			return { framebuffer, texture };
		};

		const particleVertShader = createShader(gl.VERTEX_SHADER, PARTICLE_VERT_SHADER, "particle vertex");
		if (!particleVertShader) return { isError: true };
		const particleFragShader = createShader(gl.FRAGMENT_SHADER, PARTICLE_FRAG_SHADER, "particle fragment");
		if (!particleFragShader) return { isError: true };
		const particleShader = createProgram(particleVertShader, particleFragShader, "particle");
		if (!particleShader) return { isError: true };

		// @what - Build programs for the 4 stages
		// @values - inPositionLoc{*,Dot,Blur,Finalize}: attribute locations for full-screen quad
		// @values - u*Loc: uniform locations cached to avoid repeated lookups each frame
		// [[@ncs.onRender.pipeline]]
		const inPositionLoc = gl.getAttribLocation(particleShader, "inPosition")!;
		const uNoiseOffsetLoc = gl.getUniformLocation(particleShader, "uNoiseOffset")!;
		const uAmplitudeLoc = gl.getUniformLocation(particleShader, "uAmplitude")!;
		const uSeedLoc = gl.getUniformLocation(particleShader, "uSeed")!;
		const uDotSpacingLoc = gl.getUniformLocation(particleShader, "uDotSpacing")!;
		const uDotOffsetLoc = gl.getUniformLocation(particleShader, "uDotOffset")!;
		const uSphereRadiusLoc = gl.getUniformLocation(particleShader, "uSphereRadius")!;
		const uFeatherLoc = gl.getUniformLocation(particleShader, "uFeather")!;
		const uNoiseFrequencyLoc = gl.getUniformLocation(particleShader, "uNoiseFrequency")!;
		const uNoiseAmplitudeLoc = gl.getUniformLocation(particleShader, "uNoiseAmplitude")!;
		const uOrbitAngleLoc = gl.getUniformLocation(particleShader, "uOrbitAngle")!;
		const uLayoutModeLoc = gl.getUniformLocation(particleShader, "uLayoutMode")!;
		const uLayoutSpinLoc = gl.getUniformLocation(particleShader, "uLayoutSpin")!;
		const uLayoutSpinAxisLoc = gl.getUniformLocation(particleShader, "uLayoutSpinAxis")!;
		const uLayoutOrientXLoc = gl.getUniformLocation(particleShader, "uLayoutOrientX")!;
		const uLayoutOrientYLoc = gl.getUniformLocation(particleShader, "uLayoutOrientY")!;
		const uLayoutOrientZLoc = gl.getUniformLocation(particleShader, "uLayoutOrientZ")!;

		const dotVertShader = createShader(gl.VERTEX_SHADER, DOT_VERT_SHADER, "dot vertex");
		if (!dotVertShader) return { isError: true };
		const dotFragShader = createShader(gl.FRAGMENT_SHADER, DOT_FRAG_SHADER, "dot fragment");
		if (!dotFragShader) return { isError: true };
		const dotShader = createProgram(dotVertShader, dotFragShader, "dot");
		if (!dotShader) return { isError: true };

		const inPositionLocDot = gl.getAttribLocation(dotShader, "inPosition")!;
		const uDotCountLoc = gl.getUniformLocation(dotShader, "uDotCount")!;
		const uDotRadiusLoc = gl.getUniformLocation(dotShader, "uDotRadius")!;
		const uDotRadiusPXLoc = gl.getUniformLocation(dotShader, "uDotRadiusPX")!;
		const uDotShapeLoc = gl.getUniformLocation(dotShader, "uDotShape")!;
		const uParticleTextureLoc = gl.getUniformLocation(dotShader, "uParticleTexture")!;

		const blurVertShader = createShader(gl.VERTEX_SHADER, BLUR_VERT_SHADER, "blur vertex");
		if (!blurVertShader) return { isError: true };
		const blurFragShader = createShader(gl.FRAGMENT_SHADER, BLUR_FRAG_SHADER, "blur fragment");
		if (!blurFragShader) return { isError: true };
		const blurShader = createProgram(blurVertShader, blurFragShader, "blur");
		if (!blurShader) return { isError: true };

		const inPositionLocBlur = gl.getAttribLocation(blurShader, "inPosition")!;
		const uBlurRadiusLoc = gl.getUniformLocation(blurShader, "uBlurRadius")!;
		const uBlurKernelQualityLoc = gl.getUniformLocation(blurShader, "uBlurKernelQuality")!;
		const uBlurDirectionLoc = gl.getUniformLocation(blurShader, "uBlurDirection")!;
		const uBlurInputTextureLoc = gl.getUniformLocation(blurShader, "uInputTexture")!;

		const finalizeVertShader = createShader(gl.VERTEX_SHADER, FINALIZE_VERT_SHADER, "finalize vertex");
		if (!finalizeVertShader) return { isError: true };
		const finalizeFragShader = createShader(gl.FRAGMENT_SHADER, FINALIZE_FRAG_SHADER, "finalize fragment");
		if (!finalizeFragShader) return { isError: true };
		const finalizeShader = createProgram(finalizeVertShader, finalizeFragShader, "finalize");
		if (!finalizeShader) return { isError: true };

		const inPositionLocFinalize = gl.getAttribLocation(finalizeShader, "inPosition")!;
		const uOutputColorLoc = gl.getUniformLocation(finalizeShader, "uOutputColor")!;
		const uBlurredTextureLoc = gl.getUniformLocation(finalizeShader, "uBlurredTexture")!;
		const uOriginalTextureLoc = gl.getUniformLocation(finalizeShader, "uOriginalTexture")!;
		// @what - cache uniform location for rotation
		const uRotationLoc = gl.getUniformLocation(finalizeShader, "uRotation")!;

		const fadeVertShader = createShader(gl.VERTEX_SHADER, FADE_VERT_SHADER, "fade vertex");
		if (!fadeVertShader) return { isError: true };
		const fadeFragShader = createShader(gl.FRAGMENT_SHADER, FADE_FRAG_SHADER, "fade fragment");
		if (!fadeFragShader) return { isError: true };
		const fadeShader = createProgram(fadeVertShader, fadeFragShader, "fade");
		if (!fadeShader) return { isError: true };

		const inPositionLocFade = gl.getAttribLocation(fadeShader, "inPosition")!;
		const uFadeInputTextureLoc = gl.getUniformLocation(fadeShader, "uInputTexture")!;
		const uFadeFactorLoc = gl.getUniformLocation(fadeShader, "uFadeFactor")!;

		// @what - Screen output shader that composites original + 180deg rotated copy
		const outputCompositeVertShader = createShader(gl.VERTEX_SHADER, OUTPUT_COMPOSITE_VERT_SHADER, "output composite vertex");
		if (!outputCompositeVertShader) return { isError: true };
		const outputCompositeFragShader = createShader(gl.FRAGMENT_SHADER, OUTPUT_COMPOSITE_FRAG_SHADER, "output composite fragment");
		if (!outputCompositeFragShader) return { isError: true };
		const outputCompositeShader = createProgram(outputCompositeVertShader, outputCompositeFragShader, "output composite");
		if (!outputCompositeShader) return { isError: true };

		const inPositionLocOutputComposite = gl.getAttribLocation(outputCompositeShader, "inPosition")!;
		const uOutputCompositeInputTextureLoc = gl.getUniformLocation(outputCompositeShader, "uInputTexture")!;
		const uOutputCompositeBlendModeLoc = gl.getUniformLocation(outputCompositeShader, "uBlendMode")!;
		const uOutputCompositeAlphaMixFactorLoc = gl.getUniformLocation(outputCompositeShader, "uAlphaMixFactor")!;
		const uOutputCompositeSampleCountLoc = gl.getUniformLocation(outputCompositeShader, "uOverlaySampleCount")!;
		const uOutputCompositeRotCSLoc = gl.getUniformLocation(outputCompositeShader, "uOverlayRotCS")!;

		const { framebuffer: particleFramebuffer, texture: particleTexture } = createFramebuffer(gl.NEAREST);
		const { framebuffer: dotFramebuffer, texture: dotTexture } = createFramebuffer(gl.NEAREST);
		const { framebuffer: blurXFramebuffer, texture: blurXTexture } = createFramebuffer(gl.LINEAR);
		const { framebuffer: blurYFramebuffer, texture: blurYTexture } = createFramebuffer(gl.NEAREST);
		const { framebuffer: accumFramebufferA, texture: accumTextureA } = createFramebuffer(gl.LINEAR);
		const { framebuffer: accumFramebufferB, texture: accumTextureB } = createFramebuffer(gl.LINEAR);

		// @what - Fullscreen quad buffer for all passes
		// @ex - Draw as TRIANGLE_FAN with 4 vertices
		const quadBuffer = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
		// prettier-ignore
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
            -1, 1,
            1, 1,
            1, -1
		]), gl.STATIC_DRAW);

		// @what - Use additive max blending for dot accumulation
		gl.enable(gl.BLEND);
		gl.blendEquation(gl.MAX);

		return {
			isError: false,
			particleShader,
			dotShader,
			blurShader,
			finalizeShader,
			fadeShader,
			outputCompositeShader,
			viewportSize: 0,
			particleTextureSize: 0,

			inPositionLoc,
			inPositionLocDot,
			inPositionLocBlur,
			inPositionLocFinalize,
			inPositionLocFade,
			inPositionLocOutputComposite,

			uNoiseOffsetLoc,
			uAmplitudeLoc,
			uSeedLoc,
			uDotSpacingLoc,
			uDotOffsetLoc,
			uSphereRadiusLoc,
			uFeatherLoc,
			uNoiseFrequencyLoc,
			uNoiseAmplitudeLoc,
			uOrbitAngleLoc,
			uLayoutModeLoc,
			uLayoutSpinLoc,
			uLayoutSpinAxisLoc,
			uLayoutOrientXLoc,
			uLayoutOrientYLoc,
			uLayoutOrientZLoc,

			uDotCountLoc,
			uDotRadiusLoc,
			uDotRadiusPXLoc,
			uDotShapeLoc,
			uParticleTextureLoc,

			uBlurRadiusLoc,
			uBlurKernelQualityLoc,
			uBlurDirectionLoc,
			uBlurInputTextureLoc,

			uOutputColorLoc,
			uBlurredTextureLoc,
			uOriginalTextureLoc,
			uRotationLoc,
			
			uFadeInputTextureLoc,
			uFadeFactorLoc,
			uOutputCompositeInputTextureLoc,
			uOutputCompositeBlendModeLoc,
			uOutputCompositeAlphaMixFactorLoc,
			uOutputCompositeSampleCountLoc,
			uOutputCompositeRotCSLoc,
			
			quadBuffer,

			particleFramebuffer,
			particleTexture,
			dotFramebuffer,
			dotTexture,
			blurXFramebuffer,
			blurXTexture,
			blurYFramebuffer,
			blurYTexture,
			
			accumFramebufferA,
			accumTextureA,
			accumFramebufferB,
			accumTextureB,
			
			useAccumA: true,
			lastT: 0,
			rotAngle: 0
		};
	}, []);

	// [[ncs.onResize]]
	// @what - React to canvas size changes
	// @how - Track `viewportSize` (square) and reallocate R8 render targets for dot/blur passes
	const onResize = useCallback((gl: WebGL2RenderingContext | null, state: RendererState) => {
		if (state.isError || !gl) return;

		state.viewportSize = Math.min(gl.canvas.width, gl.canvas.height);
		gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

		gl.bindTexture(gl.TEXTURE_2D, state.dotTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, state.viewportSize, state.viewportSize, 0, gl.RED, gl.UNSIGNED_BYTE, null);

		gl.bindTexture(gl.TEXTURE_2D, state.blurXTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, state.viewportSize, state.viewportSize, 0, gl.RED, gl.UNSIGNED_BYTE, null);

		gl.bindTexture(gl.TEXTURE_2D, state.blurYTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, state.viewportSize, state.viewportSize, 0, gl.RED, gl.UNSIGNED_BYTE, null);

		gl.bindTexture(gl.TEXTURE_2D, state.accumTextureA);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, state.viewportSize, state.viewportSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

		gl.bindTexture(gl.TEXTURE_2D, state.accumTextureB);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, state.viewportSize, state.viewportSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
	}, []);

	
	// [[ncs.onRender.pipeline]]
	// [[@ncs.onInit.pipelineSetup]]
	// @how - Per frame:
	// @1 [[@ncs.onRender.pass1.particles]] calc particle pos
	// @2 [[@ncs.onRender.pass2.dots]] render dots
	// @3 [[@ncs.onRender.pass3.blurX]] blur X
	// @4 [[@ncs.onRender.pass4.blurY]] blur Y
	// @5 [[@ncs.onRender.pass5.finalize]] composite with color
	let frameCount = 0; // @what - frame count for animation
	const onRender = useCallback((gl: WebGL2RenderingContext | null, data: CanvasData, state: RendererState) => {
		if (state.isError || !gl) return;

		const progress = Spicetify.Player.getProgress() / 1000;
		const progressPercent = Spicetify.Player.getProgressPercent();

		// @what - Audio/animation inputs driving noise + geometry
		// [[ncs.uNoiseOffset.noiseOffsetScale]]
		// @what - scroll the 3D noise volume as song time + amplitude-energy advance
		// @how - (0.5 * progressSec + amplitudeIntegral) * noiseOffsetScale → uNoiseOffset
		// @purpose - noiseOffsetScale is “how far” the noise field moves per unit of that time/energy sum
		// @meaning - larger = busier/warpier particle drift; negative = reverse scroll
		// @magic - default 0.75 == old hard-coded `75 * 0.01`
		const noiseOffsetScale = typeof window.visualizer?.noiseOffsetScale === "number"
			? window.visualizer.noiseOffsetScale
			: VISUALIZER_DEFAULTS.noiseOffsetScale;
		const uNoiseOffset = (0.5 * progress + sampleAccumulatedIntegral(data.amplitudeCurve, progress)) * noiseOffsetScale;

		// [[ncs.uAmplitude.amplitudeWindow]]
		// @what - moving-average loudness around current time (seconds of curve averaged)
		// @how - sampleAmplitudeMovingAverage(..., amplitudeWindow); window 0 = raw sample
		// @purpose - smooth loudness so sphere/dot size doesn’t twitch on every tiny spike
		// @meaning - smaller window = snappier; larger = smoother/laggier
		// @magic - default 0.05 == old hard-coded 50ms window
		const amplitudeWindow = typeof window.visualizer?.amplitudeWindow === "number"
			? window.visualizer.amplitudeWindow
			: VISUALIZER_DEFAULTS.amplitudeWindow;
		const uAmplitude = sampleAmplitudeMovingAverage(data.amplitudeCurve, progress, amplitudeWindow);

		// @value (uSeed) - stable seed to vary noise across tracks; here use analysis timestamp
		const uSeed = data.seed;

		// [[ncs.uOrbitAngle]]
		// @what - One visual cycle is 2π radians (XY ↔ -XY asymmetry)
		// @value (VISUAL_TURN) - visual period, this makes sure the poles make one full rotation over the course of the song
		// @value (START_OFFSET) - phase to start poles vertical; this aligns the scalar-noise (1,1) bias to vertical
		// @value (DIR) - [+1 == counter-clockwise, -1 == clockwise]
		const VISUAL_TURN = Math.PI * -2;
		const START_OFFSET = -1 * Math.PI / 4; // 45° aligns the scalar-noise (1,1) bias to vertical
		let DIR = -1;

		// @what - progress [0-1] * direction [+1 or -1] * visual turn [π] + start offset [π/4 == 45°]
		// @why - we need to account for the starting position of the poles (-45°)
		///const uOrbitAngle = progressPercent * DIR * VISUAL_TURN + START_OFFSET;
		// @what - the poles now make one full rotation over the course of the song
		const uOrbitAngle = progressPercent * VISUAL_TURN; ///(baseSpeed/* + ampGain * uAmplitude*/) * progress;/// + seedPhase;

		// @value (uDotCount) - particles per side; particle texture is uDotCount × uDotCount
		// @concerns - Increasing this scales GPU work O(n^2); keep modest for performance
        ///const minDotCount = window.visualizer.dotCount;
        ///const uDotCount = mapLinear(uAmplitude, 0, 1, minDotCount.min, minDotCount.max); ///322;
		const dotCount = window.visualizer.dotCount;
		///const uDotCount = mapLinear(uAmplitude, 0, 1, dotCount.min, dotCount.max);
		const uDotCount = mapPiecewise(uAmplitude, [
			{ x: 0, y: dotCount.min / 2 },
			{ x: 0.05, y: dotCount.min },
			{ x: 0.5, y: dotCount.max / 2 },
			{ x: 1, y: dotCount.max }
		]);

		const dotRadius = window.visualizer.dotRadius;
		let uDotRadius = 0;

		if (!window.visualizer?.dotRadiusMode || window.visualizer?.dotRadiusMode !== "actual") {
		/*-*/
		// @purpose - uses dotRadius to map dot sizes onto a sphere
		// @note - the original logic
			// @what - Dot size in NDC and pixels (for feathering/blur kernels)
			// @value (uDotRadius) - dot radius in NDC based on dot grid density and desired coverage
			// @note - we're mapping the amplitude to the dot radius, so the smaller the amplitude, the smaller the dot radius (i.e. loud = big dots, quiet = small dots)
			let desiredRadius = 0.9 / (uDotCount * (dotRadius.multiplierLow ?? 1));
			if (desiredRadius > (0.6 / (dotCount.min * (dotRadius.multiplierHigh ?? 1)))) {
				desiredRadius = (0.3 / (dotCount.min * (dotRadius.multiplierHigh ?? 1)));
			}
			uDotRadius = desiredRadius;
			/*-*/
		} else {

			// @when - 07-17-2026
			// @purpose - we want changes to dotRadius to have a far more direct effect on the 2D projection
			// @what - new "random in range" logic
			// @how - pick random float between dotRadius.min and dotRadius.max, rounded to 1 decimal place
			// @and - divide result by uDotCount * 0.5
			// @because - this means we actually USE the range of dotRadius, rather than just the min or max
			const rawRadius = dotRadius.min + Math.random() * (dotRadius.max - dotRadius.min);
			uDotRadius = (Math.round(rawRadius * 10) / 10) / (uDotCount * 0.5);
		}



		/*-*
			Math.min(
				((Math.max(
					uDotCount,
					dotCount.min * (dotRadius.multiplierHigh ?? 1)
				) / dotCount.max) * uDotCount),
				(uDotCount * (dotRadius.multiplierLow ?? 1))
			);
		/*-*/
		
		//* const uDotRadius = 0.9 / (uDotCount * 0.5);
		///const uDotRadius = mapLinear(uAmplitude, 0, 1, 0.9 / (uDotCount * 12), 0.9 / (uDotCount / 2)); ///0.9 / (uDotCount * 2);

		// @value (uDotRadiusPX) - radius in pixels to stabilize size under resolution changes
		const uDotRadiusPX = uDotRadius * 0.5 * state.viewportSize;

		// @what - Layout of the 1D strip that’s wrapped onto the sphere
		// @value (uDotSpacing) - normalized spacing between samples on the strip
		const uDotSpacing = 0.9 * (1 - 0.5 * (Math.max(uDotCount, dotCount.min * 2) / dotCount.max));

		// [[ncs.centerAvoid]]
		// @what - Shift strip by half a texel so no particle maps exactly to XY = (0, 0)
		// @why - avoids the “always-on” center dot (midpoint at fragUV ≈ 0.5,0.5)
		// @how - offset = -0.5*spacing + spacing/(2*dotCount)
		///const uDotOffset = -0.5 * uDotSpacing + uDotSpacing / (2 * uDotCount);


		const uDotOffset = -0.9 / 2; ///-0.9 / 2;

		// @what - mapping current loudness to sphere radius
		// @value (uSphereRadius) - map loudness → sphere radius; grows with amplitude
		// @note - amplitude, min-loudness, max-loudness, what size the min-loudness maps to, what size the max-loudness maps to
		const sphereRadius = window.visualizer.sphereRadius;
		// see [[@utils.ts.map]]
		///const uSphereRadius = mapLinear(uAmplitude, 0.2, 0.90, (sphereRadius.min ?? 0.5), sphereRadius.max ?? 1); ///mapLinear(uAmplitude, 0, 1, 0.75 * 0.9, 0.9);
		// see [[@utils.ts.mapAlongSegments]]
		///const uSphereRadius = mapAlongSegments(uAmplitude, 0, 0.90, [0, sphereRadius.min ?? 0.5, ((sphereRadius.min ?? 0.5) + (sphereRadius.max ?? 1)) / 2, sphereRadius.max ?? 1], { mode: 'extrapolate' });
		/*-*
		// see [[@utils.ts.mapWithSilenceGate]]
		const uSphereRadius = mapWithSilenceGate(
			uAmplitude,
			0, 0.90,
			sphereRadius.min ?? 0.5,
			sphereRadius.max ?? 1,
			{ gate: sphereRadius.gate ?? 0.002, mode: 'extrapolate', shape: smoothstep, gateMin: uDotRadius }
		);
		/*-*/
		// see [[@utils.ts.mapPiecewise]]
		const uSphereRadius = mapPiecewise(
			uAmplitude,
			[
				{ x: 0, y: uDotRadius ?? sphereRadius.gate ?? 0.002 },
				{ x: sphereRadius?.mid ?? sphereRadius.gate ?? 0.15, y: sphereRadius.min ?? 0.5 },
				{ x: 1, y: sphereRadius.max ?? 1 }
			],
			// @how - smoothstep makes both segment ends slope to 0 → smooth join at `knee`
			{ mode: 'extrapolate', shape: smoothstep }
		);

		// @what - Sphere + feathering (edge softness)
		const feather = window.visualizer.feather;
		const uFeather = Math.pow(uAmplitude + mapLinear(uAmplitude, 0, 1, (-1 * uAmplitude), feather.scalar), mapLinear(uAmplitude, 0, 1, feather.min ?? 0, feather.max ?? 3)) * (45 / 1568); ///Math.pow(uAmplitude + 3, 2) * (45 / 1568);

		// @what - Noise field configuration
		// @value (uNoiseFrequency) - base frequency of noise warp
		// @wut - closer to 1 means more uniform distribution of dots
      const noiseFrequency = window.visualizer.noiseFrequency;
		const uNoiseFrequency = mapLinear(uAmplitude, 0, 1.5, noiseFrequency.min ?? 0.5, noiseFrequency.max ?? 2)///Math.min(mapLinear(uAmplitude, 0, 1, noiseFrequency.min ?? 0.5, noiseFrequency.max ?? 2), 4); ///1.5;///9;///4;

		// @value (uNoiseAmplitude) - strength of noise displacement
		// @note - as this approaches and exceeds 1, the more large scale deformation of the sphere
      const noiseAmplitude = window.visualizer.noiseAmplitude;
		const uNoiseAmplitude = mapLinear(uAmplitude, 0, 0.85, noiseAmplitude.min ?? 0.3, noiseAmplitude.max ?? 1); ///1; ///0.9; ///0.32 * 0.9;

		// [[ncs.onRender.ensureParticleTexture]]
		// @what - Reallocate particle position texture when grid size changes
		if (state.particleTextureSize !== uDotCount) {
			state.particleTextureSize = uDotCount;

			gl.bindTexture(gl.TEXTURE_2D, state.particleTexture);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, uDotCount, uDotCount, 0, gl.RG, gl.FLOAT, null);
		}

		// [[ncs.onRender.pass1.particles]]
		// @what - Pass 1: compute particle positions into RG32F texture
		gl.disable(gl.BLEND);
		gl.bindFramebuffer(gl.FRAMEBUFFER, state.particleFramebuffer);
		gl.viewport(0, 0, uDotCount, uDotCount);

		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.useProgram(state.particleShader);
		gl.uniform1f(state.uNoiseOffsetLoc, uNoiseOffset);
		gl.uniform1f(state.uAmplitudeLoc, uAmplitude);
		gl.uniform1i(state.uSeedLoc, uSeed);
		gl.uniform1f(state.uDotSpacingLoc, uDotSpacing);
		gl.uniform1f(state.uDotOffsetLoc, uDotOffset);
		gl.uniform1f(state.uSphereRadiusLoc, uSphereRadius);
		gl.uniform1f(state.uFeatherLoc, uFeather);
		gl.uniform1f(state.uNoiseFrequencyLoc, uNoiseFrequency);
		gl.uniform1f(state.uNoiseAmplitudeLoc, uNoiseAmplitude);
		gl.uniform1f(state.uOrbitAngleLoc, uOrbitAngle);

		// [[ncs.layoutMode]]
		// @what - which 3D layout the strip maps onto (sphere/disc/cylinder/torus)
		const rawLayout = window.visualizer?.layoutMode as LayoutMode | undefined;
		const uLayoutMode = (rawLayout && rawLayout in LAYOUT_MODE_TO_INT)
			? LAYOUT_MODE_TO_INT[rawLayout]
			: LAYOUT_MODE_TO_INT[VISUALIZER_DEFAULTS.layoutMode];
		gl.uniform1i(state.uLayoutModeLoc, uLayoutMode);

		// [[ncs.layoutSpin]]
		// @what - wall-clock tumble: rev/sec * direction → radians for the shader
		// @how - angle = timeSec * speed * ±2π; axis is a preset X/Y/Z
		const spinSpeedRaw = typeof window.visualizer?.layoutSpinSpeed === "number"
			? window.visualizer.layoutSpinSpeed
			: VISUALIZER_DEFAULTS.layoutSpinSpeed;
		const spinDir = window.visualizer?.layoutSpinDirection === "reverse" ? -1 : 1;
		const uLayoutSpin = (performance.now() / 1000) * spinSpeedRaw * spinDir * Math.PI * 2;
		gl.uniform1f(state.uLayoutSpinLoc, uLayoutSpin);

		const rawAxis = window.visualizer?.layoutSpinAxis as LayoutSpinAxis | undefined;
		const uLayoutSpinAxis = (rawAxis && rawAxis in LAYOUT_SPIN_AXIS_TO_INT)
			? LAYOUT_SPIN_AXIS_TO_INT[rawAxis]
			: LAYOUT_SPIN_AXIS_TO_INT[VISUALIZER_DEFAULTS.layoutSpinAxis];
		gl.uniform1i(state.uLayoutSpinAxisLoc, uLayoutSpinAxis);

		// [[ncs.layoutOrient]]
		// @what - stationary pose degrees → radians; applied X→Y→Z before continuous spin
		const degToRad = Math.PI / 180;
		const orientX = typeof window.visualizer?.layoutOrientX === "number"
			? window.visualizer.layoutOrientX
			: VISUALIZER_DEFAULTS.layoutOrientX;
		const orientY = typeof window.visualizer?.layoutOrientY === "number"
			? window.visualizer.layoutOrientY
			: VISUALIZER_DEFAULTS.layoutOrientY;
		const orientZ = typeof window.visualizer?.layoutOrientZ === "number"
			? window.visualizer.layoutOrientZ
			: VISUALIZER_DEFAULTS.layoutOrientZ;
		gl.uniform1f(state.uLayoutOrientXLoc, orientX * degToRad);
		gl.uniform1f(state.uLayoutOrientYLoc, orientY * degToRad);
		gl.uniform1f(state.uLayoutOrientZLoc, orientZ * degToRad);

		gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
		gl.enableVertexAttribArray(state.inPositionLoc);
		gl.vertexAttribPointer(state.inPositionLoc, 2, gl.FLOAT, false, 0, 0);
		gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

		// [[ncs.onRender.pass2.dots]]
		// @what - Pass 2: render instanced dots using particle positions
		gl.enable(gl.BLEND);
		gl.bindFramebuffer(gl.FRAMEBUFFER, state.dotFramebuffer);
		gl.viewport(0, 0, state.viewportSize, state.viewportSize);

		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.useProgram(state.dotShader);
		gl.uniform1i(state.uDotCountLoc, uDotCount);
		gl.uniform1f(state.uDotRadiusLoc, uDotRadius);
		gl.uniform1f(state.uDotRadiusPXLoc, uDotRadiusPX);
		// [[ncs.dotShape]]
		// @what - particle glyph silhouette (fragment SDF); fallback circle if unknown
		const rawShape = window.visualizer?.dotShape as DotShape | undefined;
		const uDotShape = (rawShape && rawShape in DOT_SHAPE_TO_INT)
			? DOT_SHAPE_TO_INT[rawShape]
			: DOT_SHAPE_TO_INT[VISUALIZER_DEFAULTS.dotShape];
		gl.uniform1i(state.uDotShapeLoc, uDotShape);
		gl.uniform1i(state.uParticleTextureLoc, 0);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, state.particleTexture);

		gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
		gl.enableVertexAttribArray(state.inPositionLocDot);
		gl.vertexAttribPointer(state.inPositionLocDot, 2, gl.FLOAT, false, 0, 0);

		gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, uDotCount * uDotCount);

		// [[ncs.onRender.pass3.blurX]]
		// @what - Pass 3: horizontal blur of the dot mask
		gl.bindFramebuffer(gl.FRAMEBUFFER, state.blurXFramebuffer);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		// [[ncs.blur.spatialFromConfig]]
		// @what - blurX/blurY are viewport fractions; multiply by viewportSize → pixel sigma for the shader
		// @note - negatives allowed (interesting looks); quality is independent of radius
		const blurXCoeff = typeof window.visualizer?.blurX === "number" ? window.visualizer.blurX : VISUALIZER_DEFAULTS.blurX;
		const blurYCoeff = typeof window.visualizer?.blurY === "number" ? window.visualizer.blurY : VISUALIZER_DEFAULTS.blurY;
		// [[ncs.blur.blurKernelQuality]]
		// @what - tap-count multiplier after radius sizing (see blur.ts fragSupport)
		// @meaning - higher = creamier spatial bloom, more GPU; lower = cheaper/crisper
		// @magic - default 15 == old hard-coded kernel multiplier
		const blurKernelQuality = typeof window.visualizer?.blurKernelQuality === "number"
			? window.visualizer.blurKernelQuality
			: VISUALIZER_DEFAULTS.blurKernelQuality;

		gl.useProgram(state.blurShader);
		gl.uniform1f(state.uBlurRadiusLoc, blurXCoeff * state.viewportSize);
		gl.uniform1f(state.uBlurKernelQualityLoc, blurKernelQuality);
		gl.uniform2f(state.uBlurDirectionLoc, 1 / state.viewportSize, 0);
		gl.uniform1i(state.uBlurInputTextureLoc, 0);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, state.dotTexture);

		gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
		gl.enableVertexAttribArray(state.inPositionLocBlur);
		gl.vertexAttribPointer(state.inPositionLocBlur, 2, gl.FLOAT, false, 0, 0);
		gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

		// [[ncs.onRender.pass4.blurY]]
		// @what - Pass 4: vertical blur, reading from horizontal blur result
		gl.bindFramebuffer(gl.FRAMEBUFFER, state.blurYFramebuffer);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.uniform1f(state.uBlurRadiusLoc, blurYCoeff * state.viewportSize);
		gl.uniform2f(state.uBlurDirectionLoc, 0, 1 / state.viewportSize);
		gl.bindTexture(gl.TEXTURE_2D, state.blurXTexture);
		gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

		// @what - Ping-pong accumulation buffers
		const currentAccumFramebuffer = state.useAccumA ? state.accumFramebufferA : state.accumFramebufferB;
		const previousAccumTexture = state.useAccumA ? state.accumTextureB : state.accumTextureA;
		const currentAccumTexture = state.useAccumA ? state.accumTextureA : state.accumTextureB;

		// [[ncs.onRender.pass5.accumulate]]
		// @what - Bind current accumulation buffer
		gl.bindFramebuffer(gl.FRAMEBUFFER, currentAccumFramebuffer);
		gl.viewport(0, 0, state.viewportSize, state.viewportSize);
		
		// @what - Clear the buffer, then draw the faded previous frame
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		// @when - 06-16-2026
		// [[visualizer.ghost-circle-fix.js]]
		// [[@visualizer.ghost-circle-fix.css]]
		// @value (motionBlur) - constant blur factor
		// @value (clearAfterFrames) - base frame budget before forced wipe
		// @note - periodically disable motion blur so trails don’t burn a ghost circle
		// @why - to advoid the "ghost" circle which persists whenever blur is enabled
		// @because - don't want to get burn-in on my OLED monitor
		// @how - threshold ≈ (1 / max(0.1, motionBlur)) * clearAfterFrames; then fadeFactor = 0 and reset counter
		// @because - the higher the blur factor, the more often we need to clear the motion blur
		const clearAfterFrames = typeof window.visualizer?.clearAfterFrames === "number"
			? window.visualizer.clearAfterFrames
			: VISUALIZER_DEFAULTS.clearAfterFrames;
		let fadeFactor = 0.85;
		if (
			frameCount >= (
				(1 / (Math.max(0.1, window.visualizer?.motionBlur ?? 0))) * clearAfterFrames
			)
		) {
			const mb = 0;
			fadeFactor = mb;
			frameCount = 0;
		} else {
			const mb = window.visualizer?.motionBlur;
			if (typeof mb === "number") {
				fadeFactor = mb;
			} else if (mb && typeof (mb as any).max === "number") {
				fadeFactor = (mb as any).max;
			}
			frameCount++;
		}
		/*-*
		const mb = (frameCount >= 500) ? 0 : window.visualizer?.motionBlur : 0;
		if (typeof mb === "number") {
			fadeFactor = mb;
		} else if (mb && typeof (mb as any).max === "number") {
			fadeFactor = (mb as any).max;
		}
		/*-*/

		// @what - Draw previous frame with fade
		gl.disable(gl.BLEND); // Just copy the faded previous frame
		gl.useProgram(state.fadeShader);
		gl.uniform1f(state.uFadeFactorLoc, fadeFactor); // Fade factor
		gl.uniform1i(state.uFadeInputTextureLoc, 0);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, previousAccumTexture);
		
		gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
		gl.enableVertexAttribArray(state.inPositionLocFade);
		gl.vertexAttribPointer(state.inPositionLocFade, 2, gl.FLOAT, false, 0, 0);
		gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

		// [[ncs.onRender.pass6.finalize]]
		// @what - Draw new frame on top with premultiplied alpha blending
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // Premultiplied alpha blending
		gl.blendEquation(gl.FUNC_ADD);

		// [[ncs.colorFromPitch]]
		// @what - Interpolate mixed color from curve based on current progress
		const pitchIdxEntry = binarySearchIndex(data.mixedColorCurve, e => e.x, progress);
		const currentEntry = data.mixedColorCurve[pitchIdxEntry];
		let cr = currentEntry.r, cg = currentEntry.g, cb = currentEntry.b;
		
		if (pitchIdxEntry < data.mixedColorCurve.length - 1) {
			const nextEntry = data.mixedColorCurve[pitchIdxEntry + 1];
			// @how - linearly interpolate between the two segments
			const t = Math.max(0, Math.min(1, (progress - currentEntry.x) / (nextEntry.x - currentEntry.x)));
			cr = currentEntry.r + (nextEntry.r - currentEntry.r) * t;
			cg = currentEntry.g + (nextEntry.g - currentEntry.g) * t;
			cb = currentEntry.b + (nextEntry.b - currentEntry.b) * t;
		}

		gl.useProgram(state.finalizeShader);
		gl.uniform3f(state.uOutputColorLoc, (cr / 255) + (Math.random() * 0.1), (cg / 255) + (Math.random() * 0.1), (cb / 255) + (Math.random() * 0.1));
		gl.uniform1i(state.uBlurredTextureLoc, 0);
		gl.uniform1i(state.uOriginalTextureLoc, 1);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, state.blurYTexture);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, state.dotTexture);

		gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
		gl.enableVertexAttribArray(state.inPositionLocFinalize);
		gl.vertexAttribPointer(state.inPositionLocFinalize, 2, gl.FLOAT, false, 0, 0);
		gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

		// [[ncs.onRender.pass7.output]]
		// @what - Draw the accumulation buffer to the screen
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.disable(gl.BLEND);
		gl.useProgram(state.outputCompositeShader);
		gl.uniform1i(state.uOutputCompositeInputTextureLoc, 0);
		// @what - blend mode from runtime config, with safe fallback for older saved configs or unknown values
		const blendMode: OverlayBlendMode = window.visualizer?.overlayBlendMode || window?.visualizerLastOverlayBlendMode || "alpha_mix";
		const blendModeId = OVERLAY_BLEND_MODE_SHADER_MAP[blendMode] ?? 0;
		gl.uniform1i(state.uOutputCompositeBlendModeLoc, blendModeId);
		gl.uniform1f(state.uOutputCompositeAlphaMixFactorLoc, DEFAULT_ALPHA_MIX_FACTOR);
		// @what - multi-copy overlay setup from current visualizer config
		// @how - explicit overlayAnglesDeg overrides evenly spaced count/offset generation
		const overlayAnglesDeg = ncsResolveOverlayAnglesDeg();
		const overlaySampleCount = Math.max(1, Math.min(overlayAnglesDeg.length, OUTPUT_COMPOSITE_MAX_OVERLAY_SAMPLES));
		const overlayRotCSPacked = ncsBuildOverlayRotCSFlat(overlayAnglesDeg);
		gl.uniform1i(state.uOutputCompositeSampleCountLoc, overlaySampleCount);
		gl.uniform2fv(state.uOutputCompositeRotCSLoc, overlayRotCSPacked);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, currentAccumTexture);
		
		gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
		gl.enableVertexAttribArray(state.inPositionLocOutputComposite);
		gl.vertexAttribPointer(state.inPositionLocOutputComposite, 2, gl.FLOAT, false, 0, 0);
		gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

		// @what - Swap accumulation buffers
		state.useAccumA = !state.useAccumA;
	}, []);

	// [[ncs.fixedResolution]]
	// @value - locked square bitmap + CSS box; visual fit is `.visualizer-stage` `scale` (see app.tsx)
	const FIXED_RESOLUTION = 1440;

	return (
		<AnimatedCanvas
			isEnabled={props.isEnabled}
			data={{ themeColor: props.themeColor, seed, amplitudeCurve, mixedColorCurve }}
			contextType="webgl2"
			onInit={onInit}
			onResize={onResize}
			onRender={onRender}
			fixedResolution={FIXED_RESOLUTION}
			style={{
				width: FIXED_RESOLUTION,
				height: FIXED_RESOLUTION,
				objectFit: "contain",
				///rotate: `${parseInt(window.mm.rotation, 10)}deg`,
				/*-*
				// @what - Set custom property for animation duration using inline style
				// @why - TypeScript's CSSProperties does not recognize custom properties, so we must use type assertion
				// @info - This avoids the TS error about unknown property
				// @concerns - If more custom properties are needed, consider a utility for merging style objects
				...({
					"--visualizer-rotation": `${parseInt(window.mm.rotation, 10)}deg`
				} as React.CSSProperties)
				/*-*/
			}}
			className={window.visualizerHypnoMode ? "HYPNOTOAD" : ""}
		/>
	);
}

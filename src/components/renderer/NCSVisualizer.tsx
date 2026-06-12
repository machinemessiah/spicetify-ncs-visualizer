import React, { useCallback, useContext, useMemo } from "react";
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
import { ErrorHandlerContext, ErrorRecovery } from "../../error";
import { VISUALIZER_DEFAULTS } from "../../config/visualizer.defaults";
import { RendererProps } from "../../app";
///import { VisualizerConfig, VisualizerRange, VisualizerDotRadius } from "../../types/visualizer-global";

// [[ncs.palette.cssRgb]]
// @what - Load 12 colors from CSS vars that contain raw "r, g, b" triples

function getCssVarRgbTuple(varName: string): [number, number, number] | null {
	// @how - Read "--mm-gpc-XX-rgb" -> "r, g, b"
	const raw = getComputedStyle(document.documentElement).getPropertyValue(varName);
	if (!raw) return null;
	const parts = raw.split(",").map(s => parseFloat(s.trim()));
	if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
	return [parts[0], parts[1], parts[2]];
}

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

// @fallback - 12 static RGBs (only used if some CSS vars not found)
const DEFAULT_PITCH_RGB: [number, number, number][] = [
	[255, 82, 96], [255, 126, 41], [255, 196, 0], [254, 217, 15],
	[183, 241, 9], [51, 255, 0], [0, 255, 170], [0, 184, 230],
	[0, 162, 255], [180, 106, 254], [255, 0, 195], [255, 77, 136]
];

// [[ncs.visualizer.defaults.init]]
// [[@types.visualizer.global]]
// @what - Initialize global `window.visualizer` once from defaults for live tweaking
// @how - Use a deep clone so runtime changes don't mutate the defaults object
if (!window.visualizer) {
	// @how - minimal deep clone; values are primitives
	///window.visualizer = JSON.parse(JSON.stringify(VISUALIZER_DEFAULTS));
	let storedConfigs: typeof VISUALIZER_DEFAULTS[] = JSON.parse(localStorage.getItem("mm.visualizer.CONFIGS") ?? "[]");
	console.g.black("[NCSVisualizer] Stored configs");
	console.g.white(storedConfigs);
	if (storedConfigs.length > 0) {
		window.visualizer = storedConfigs[storedConfigs.length - 1];
		console.gold("[NCSVisualizer] Using stored config", window.visualizer);
	} else {;
		window.visualizer = JSON.parse(JSON.stringify(VISUALIZER_DEFAULTS));
		console.palevioletred("[NCSVisualizer] Using default config", window.visualizer);
	}
	console.groupEnd();
}

type CanvasData = {
	themeColor: Spicetify.Color;
	seed: number;
	amplitudeCurve: CurveEntry[];
	// @what - time → mixed color [r, g, b]
	mixedColorCurve: { x: number; r: number; g: number; b: number }[];
};

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
			viewportSize: number;
			particleTextureSize: number;

			inPositionLoc: number;
			inPositionLocDot: number;
			inPositionLocBlur: number;
			inPositionLocFinalize: number;
			inPositionLocFade: number;

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

			uDotCountLoc: WebGLUniformLocation;
			uDotRadiusLoc: WebGLUniformLocation;
			uDotRadiusPXLoc: WebGLUniformLocation;
			uParticleTextureLoc: WebGLUniformLocation;

			uBlurRadiusLoc: WebGLUniformLocation;
			uBlurDirectionLoc: WebGLUniformLocation;
			uBlurInputTextureLoc: WebGLUniformLocation;

			uOutputColorLoc: WebGLUniformLocation;
			uBlurredTextureLoc: WebGLUniformLocation;
			uOriginalTextureLoc: WebGLUniformLocation;

			uFadeInputTextureLoc: WebGLUniformLocation;
			uFadeFactorLoc: WebGLUniformLocation;

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
		const vals = PITCH_RGB_VARS.map(getCssVarRgbTuple).filter(Boolean) as [number, number, number][];
		return vals.length === PITCH_RGB_VARS.length ? vals : DEFAULT_PITCH_RGB;
	}, []);

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

		gl.canvas.style.setProperty('--visualizer-rotation', `${Math.floor(Math.random() * 360)}deg`);

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
		const uParticleTextureLoc = gl.getUniformLocation(dotShader, "uParticleTexture")!;

		const blurVertShader = createShader(gl.VERTEX_SHADER, BLUR_VERT_SHADER, "blur vertex");
		if (!blurVertShader) return { isError: true };
		const blurFragShader = createShader(gl.FRAGMENT_SHADER, BLUR_FRAG_SHADER, "blur fragment");
		if (!blurFragShader) return { isError: true };
		const blurShader = createProgram(blurVertShader, blurFragShader, "blur");
		if (!blurShader) return { isError: true };

		const inPositionLocBlur = gl.getAttribLocation(blurShader, "inPosition")!;
		const uBlurRadiusLoc = gl.getUniformLocation(blurShader, "uBlurRadius")!;
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
			viewportSize: 0,
			particleTextureSize: 0,

			inPositionLoc,
			inPositionLocDot,
			inPositionLocBlur,
			inPositionLocFinalize,
			inPositionLocFade,

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

			uDotCountLoc,
			uDotRadiusLoc,
			uDotRadiusPXLoc,
			uParticleTextureLoc,

			uBlurRadiusLoc,
			uBlurDirectionLoc,
			uBlurInputTextureLoc,

			uOutputColorLoc,
			uBlurredTextureLoc,
			uOriginalTextureLoc,
			uRotationLoc,
			
			uFadeInputTextureLoc,
			uFadeFactorLoc,
			
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
	const onRender = useCallback((gl: WebGL2RenderingContext | null, data: CanvasData, state: RendererState) => {
		if (state.isError || !gl) return;

		const progress = Spicetify.Player.getProgress() / 1000;
		const progressPercent = Spicetify.Player.getProgressPercent();

		// @what - Audio/animation inputs driving noise + geometry
		// @value (uNoiseOffset) - scroll noise field over time + energy integral for musical motion
		const uNoiseOffset = (0.5 * progress + sampleAccumulatedIntegral(data.amplitudeCurve, progress)) * 75 * 0.01;

		// @value (uAmplitude) - moving average loudness around current time, smooths responsiveness
		const uAmplitude = sampleAmplitudeMovingAverage(data.amplitudeCurve, progress, 0.05);

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

		// @what - Dot size in NDC and pixels (for feathering/blur kernels)
		// @value (uDotRadius) - dot radius in NDC based on dot grid density and desired coverage
		// @note - we're mapping the amplitude to the dot radius, so the smaller the amplitude, the smaller the dot radius (i.e. loud = big dots, quiet = small dots)
		/*-*/
		const dotRadius = window.visualizer.dotRadius;
		let desiredRadius = 0.9 / (uDotCount * (dotRadius.multiplierLow ?? 1));
		if (desiredRadius > (0.6 / (dotCount.min * (dotRadius.multiplierHigh ?? 1) ))) {
			desiredRadius = (0.3 / (dotCount.min * (dotRadius.multiplierHigh ?? 1) ));
		}
		const uDotRadius = desiredRadius;
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

		gl.useProgram(state.blurShader);
		gl.uniform1f(state.uBlurRadiusLoc, 0.01 * state.viewportSize);
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

		// @value (motionBlur) - constant blur factor
		let fadeFactor = 0.85;
		const mb = window.visualizer?.motionBlur;
		if (typeof mb === "number") {
			fadeFactor = mb;
		} else if (mb && typeof (mb as any).max === "number") {
			fadeFactor = (mb as any).max;
		}

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
		gl.useProgram(state.fadeShader);
		gl.uniform1f(state.uFadeFactorLoc, 1.0); // No fade for output
		gl.uniform1i(state.uFadeInputTextureLoc, 0);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, currentAccumTexture);
		
		gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
		gl.enableVertexAttribArray(state.inPositionLocFade);
		gl.vertexAttribPointer(state.inPositionLocFade, 2, gl.FLOAT, false, 0, 0);
		gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

		// @what - Swap accumulation buffers
		state.useAccumA = !state.useAccumA;
	}, []);

	return (
		<AnimatedCanvas
			isEnabled={props.isEnabled}
			data={{ themeColor: props.themeColor, seed, amplitudeCurve, mixedColorCurve }}
			contextType="webgl2"
			onInit={onInit}
			onResize={onResize}
			onRender={onRender}
			style={{
				width: "100%",
				height: "100%",
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
			sizeConstraint={(width, height) => {
				const size = Math.min(width, height);
				return { width: size, height: size };
			}}
		/>
	);
}

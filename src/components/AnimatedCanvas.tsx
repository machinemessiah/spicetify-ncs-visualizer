import React, { useRef, useEffect, useState, useCallback } from "react";

interface ContextTypeMap {
	"2d": CanvasRenderingContext2D;
	webgl: WebGLRenderingContext;
	webgl2: WebGL2RenderingContext;
	bitmaprenderer: ImageBitmapRenderingContext;
}

// [[animatedCanvas.surface]]
// @what - Generic animated canvas component for multiple context types
// @how - Initializes context + state once, observes size, and runs an RAF render loop when enabled
export default function AnimatedCanvas<T, U, V extends keyof ContextTypeMap>(props: {
	contextType: V;
	onInit: (ctx: ContextTypeMap[V] | null) => U;
	onResize: (ctx: ContextTypeMap[V] | null, state: U) => void;
	onRender: (ctx: ContextTypeMap[V] | null, data: T, state: U, time: number) => void;

	style?: React.CSSProperties;
	sizeConstraint?: (width: number, height: number) => { width: number; height: number };

	data: T;
	isEnabled: boolean;
}) {
	const { contextType, onInit, onResize, onRender, style, data, isEnabled } = props;
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [state, setState] = useState<U | null>(null);

	// [[animatedCanvas.updateResolution]]
	// @what - Update canvas resolution based on window size and device pixel ratio
	// @how - Scale by device pixel ratio to maintain crisp visuals
	const updateResolution = useCallback((canvas: HTMLCanvasElement, win: Window) => {
		const screenWidth = Math.round(canvas.clientWidth * window.devicePixelRatio);
		const screenHeight = Math.round(canvas.clientHeight * window.devicePixelRatio);

		// @optional - sizeConstraint can enforce square or other aspect constraints
		const { width: newWidth, height: newHeight } = props.sizeConstraint?.(screenWidth, screenHeight) ?? {
			width: screenWidth,
			height: screenHeight
		};

		if (canvas.width === newWidth && canvas.height === newHeight) return;
		canvas.width = newWidth;
		canvas.height = newHeight;
	}, []);

	// [[animatedCanvas.init]]
	// @how - Initialize once: create context, init state, do a first resize
	useEffect(() => {
		if (!onInit) return;

		const canvas = canvasRef.current;
		if (!canvas) return;

		const win = canvas.ownerDocument.defaultView;
		if (!win) return;

		const context = canvas.getContext(contextType) as ContextTypeMap[V] | null;

		const state = onInit(context);
		updateResolution(canvas, win);
		onResize(context, state);
		setState(state);

		return () => setState(null);
	}, [contextType, onInit]);

	// [[animatedCanvas.loop]]
	// @how - RAF loop only when enabled and after initial state exists
	useEffect(() => {
		if (!isEnabled || !state || !onRender) return;

		const canvas = canvasRef.current;
		if (!canvas) return;

		const win = canvas.ownerDocument.defaultView;
		if (!win) return;

		const context = canvas.getContext(contextType) as ContextTypeMap[V] | null;

		let requestId = 0;
		const wrapper = (time: number) => {
			if (!state) return;

			onRender(context, data, state, time);
			requestId = win.requestAnimationFrame(wrapper);
		};

		requestId = win.requestAnimationFrame(wrapper);
		return () => {
			if (requestId) win.cancelAnimationFrame(requestId);
		};
	}, [contextType, onRender, data, state, isEnabled]);

	// [[animatedCanvas.resizeObserver]]
	// @how - Observe element resize and trigger resolution + onResize(state)
	useEffect(() => {
		if (!canvasRef.current) return;

		const win = canvasRef.current.ownerDocument.defaultView;
		if (!win) return;

		const resizeObserver = new win.ResizeObserver(() => {
			const canvas = canvasRef.current;
			if (!canvas) return;

			const win = canvas.ownerDocument.defaultView;
			if (!win) return;

			updateResolution(canvas, win);

			const context = canvas.getContext(contextType) as ContextTypeMap[V] | null;
			if (context && state) onResize(context, state);
		});

		resizeObserver.observe(canvasRef.current);
		return () => resizeObserver.disconnect();
	}, [contextType, onResize, state]);

	return (
		<canvas
			ref={canvasRef}
			style={{
				...(style || {}),
				// @what - Hide canvas when disabled; prevents flashing between renderer switches
				...(isEnabled ? {} : { visibility: "hidden" })
			}}
			className="visualizer-canvas"
		/>
	);
}

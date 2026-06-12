// @@ binarySearchIndex
// @desc - Find rightmost index whose x ≤ position in a sorted array
// @param - array: sorted by converter(value,index)
// @param - converter: produce x value for element
// @param - position: target x
// @return - index in [0, array.length-1]
export function binarySearchIndex<T>(array: T[], converter: (value: T, index: number) => number, position: number): number {
	let lowerBound = 0;
	let upperBound = array.length;

	while (upperBound - lowerBound > 1) {
		const testIndex = Math.floor((upperBound + lowerBound) / 2);
		const pointPos = converter(array[testIndex], testIndex);

		if (pointPos <= position) lowerBound = testIndex;
		else upperBound = testIndex;
	}

	return lowerBound;
}

// @@ decibelsToAmplitude
// @desc - Convert dB ([-∞, ~0]) to normalized amplitude [0,1]
// @param - decibels: input decibel value
// @return - normalized amplitude
export function decibelsToAmplitude(decibels: number): number {
	return Math.min(Math.max(Math.pow(10, decibels / 20), 0), 1);
}

// @@ smoothstep
// @desc - Cubic smooth interpolation on [0,1] (C1 continuous)
// @param - x: input value
// @return - interpolated value
export function smoothstep(x: number): number {
	//return x * x * x * (3 * x * (2 * x - 5) + 10);
	return x * x * (3 - 2 * x);
}

// @@ mapLinear
// @desc - Linear remap from [iMin,iMax] to [oMin,oMax]
// @param - value: input value
// @param - iMin: input min
// @param - iMax: input max
// @param - oMin: output min
// @param - oMax: output max
// @return - remapped value
export function mapLinear(value: number, iMin: number, iMax: number, oMin: number, oMax: number): number {
	value = (value - iMin) / (iMax - iMin);
	value = value * (oMax - oMin) + oMin;
	return value;
}

// [[utils.ts.mapAlongSegments]]
// see [[@utils.ts.sampleSegmentedFunction]] (the more general non-uniform sampler)
// @@ mapAlongSegments
// @desc - Map `value` in [iMin,iMax] onto a piecewise-linear curve defined by uniformly spaced samples
// @param - value: input value
// @param - iMin: input min
// @param - iMax: input max
// @param - curve: array of y-samples (>= 2), uniformly spaced across [0,1]
// @optional - options: { mode?: 'clamp'|'extrapolate', shape?: (t:number)=>number }
// @return - interpolated y value at the corresponding position
// @what - Remaps then linearly interpolates between floor/ceil curve samples
// @how - Normalize to t in [0,1] → (optionally) shape t → scale to segment index → lerp between neighbors
// @why - O(1) sampling for uniform x; no search required
// @concerns - If curve.length < 2 or iMin==iMax, returns curve[0]; consider guarding upstream if different behavior desired
// @ex - mapAlongSegments(0.5, 0, 1, [0, 25, 16, 7, 31, 12]) → 11.5
export function mapAlongSegments(
	value: number,
	iMin: number,
	iMax: number,
	curve: number[],
	options?: { mode?: 'clamp' | 'extrapolate'; shape?: (t: number) => number }
): number {
	const n = curve.length;
	if (n === 0) return 0;        // @note - empty curve, fallback
	if (n === 1) return curve[0]; // @note - constant curve
	if (iMin === iMax) return curve[0];

	const mode = options?.mode ?? 'clamp';

	// @value - normalized input position
	let t = (value - iMin) / (iMax - iMin);

	// @info - optional shaping (e.g., smoothstep, ease-in/out, Math.sin, etc.)
	if (options?.shape) t = options.shape(t);

	if (mode === 'clamp') {
		// @how - clamp input to the domain; output sticks to endpoints outside range
		t = Math.min(Math.max(t, 0), 1);
	}
	// @value - scaled position across segments
	const scaled = t * (n - 1);

	// @how - pick left segment index; clamp to valid segment bounds (we still allow frac <0 or >1 for extrapolation)
	let i = Math.floor(scaled);
	if (i < 0) i = 0;
	if (i > n - 2) i = n - 2;

	const a = curve[i];
	const b = curve[i + 1];
	const localT = scaled - i; // @info - may be <0 or >1 if mode === 'extrapolate'

	// @how - standard linear interpolation
	return a + (b - a) * localT;
}

/**
 * [[utils.ts.mapWithSilenceGate]]
 * 
 * @@ mapWithSilenceGate
 * @desc - Map with a near-zero "silence" gate: values ≤ gate → 0; above gate → [oMin,oMax], with optional shaping and extrapolation
 * 
 * @param - value: input value
 * @param - iMin: input min
 * @param - iMax: input max (the "regular" max; values above this may extrapolate)
 * @param - oMin: floor output once past the gate (e.g., sphereRadius.min)
 * @param - oMax: ceiling output at iMax (may be exceeded if mode==='extrapolate')
 * @optional - options: { gate?: number; mode?: 'clamp'|'extrapolate'; shape?: (t:number)=>number }
 * 
 * @return - mapped value with silence gating
 * 
 * @how - Normalize → if below gate → 0; else remap [gate,1] → [oMin,oMax] and optionally shape; allow extrapolation if requested
 * @why - Collapse to 0 during silence, but keep a minimum floor during normal activity
 */
export function mapWithSilenceGate(
	value: number,
	iMin: number,
	iMax: number,
	oMin: number,
	oMax: number,
	options?: { gate?: number; mode?: 'clamp' | 'extrapolate'; shape?: (t: number) => number; gateMin?: number }
): number {
	if (iMax === iMin) return 0; // @huh - degenerate input range

	const mode = options?.mode ?? 'extrapolate';
	const gateAbs = options?.gate ?? 0.002; // @value - near-zero threshold in input units
	let t = (value - iMin) / (iMax - iMin);   // @value - normalized [~0..~1]
	const gateT = (gateAbs - iMin) / (iMax - iMin);

	if (t <= gateT) return options?.gateMin ?? 0;

	if (mode === 'clamp') t = Math.min(t, 1);
	let s = (t - gateT) / (1 - gateT);       // @how - remap [gateT..1] → [0..1]
	if (options?.shape) s = options.shape(s);

	return oMin + (oMax - oMin) * s;
}

/**
 * [[utils.ts.mapPiecewise]]
 * see [[@utils.ts.sampleSegmentedFunction]] (the more general non-uniform sampler)
 *
 * @@ mapPiecewise
 * @desc - Piecewise-linear mapping through arbitrary control points (x: input, y: output)
 * @meaning - like mapLinear but with an arbitrary number of control points ({x:0,y:0},...,{x:0.15,y:min},...,{x: 0.5,y:mid},...,{x:0.90,y:max},...,{x:1,y:1})
 * 
 * @param - value: input value
 * @param - points: sorted by x ascending, length >= 2 (e.g., [{x:0,y:0},{x:0.15,y:min},{x:0.90,y:max}])
 * @optional - options: { mode?: 'clamp'|'extrapolate', shape?: (t:number)=>number }
 * 
 * @return - interpolated (or extrapolated) y
 * 
 * @how - Binary-search segment, compute local t, optional shaping, then lerp y
 * @concerns - `points` must be sorted by x and have unique x's; shaping applies only when 0 ≤ t ≤ 1
*/
export function mapPiecewise(
	value: number,
	points: { x: number; y: number }[],
	options?: { mode?: 'clamp' | 'extrapolate'; shape?: (t: number) => number }
): number {
	const n = points.length;
	if (n === 0) return 0;            // @note - no data
	if (n === 1) return points[0].y;  // @note - constant

	const mode = options?.mode ?? 'extrapolate';

	// @how - find rightmost index i with points[i].x ≤ value
	const i = binarySearchIndex(points, p => p.x, value);

	// @how - right of the last point
	if (i >= n - 1) {
		if (mode === 'clamp') return points[n - 1].y;
		const a = points[n - 2], b = points[n - 1];
		const t = (value - a.x) / (b.x - a.x);
		return a.y + (b.y - a.y) * t; // linear extrapolation beyond last
	}

	const a = points[i];
	const b = points[i + 1];
	let t = (value - a.x) / (b.x - a.x);

	// @how - left of the first point (t < 0 on first segment)
	if (t < 0) {
		if (mode === 'clamp') return points[0].y;
		return a.y + (b.y - a.y) * t; // linear extrapolation before first
	}

	// @info - apply shaping only inside the segment
	if (options?.shape && t >= 0 && t <= 1) t = options.shape(t);

	return a.y + (b.y - a.y) * t;
}

/**
 * [[utils.ts.map]]
 * 
 * @@ map
 * @desc - Remap with custom interpolation function (e.g. smoothstep)
 * 
 * @param - value: input value
 * @param - iMin: input min
 * @param - iMax: input max
 * @param - interpolate: interpolation function (e.g. smoothstep)
 * @param - oMin: output min
 * @param - oMax: output max
 * 
 * @return - remapped value
 */
export function map(
	value: number,
	iMin: number,
	iMax: number,
	interpolate: (x: number) => number,
	oMin: number,
	oMax: number
): number {
	value = (value - iMin) / (iMax - iMin);
	value = interpolate(value);
	value = value * (oMax - oMin) + oMin;
	return value;
}
// @@ integrateLinearSegment
// @desc - Integral under the line segment p1→p2 over [p1.x, p2.x]
// @note - calculate the integral of the linear function through p1 and p2 between p1.x and p2.x
export function integrateLinearSegment(p1: CurveEntry, p2: CurveEntry): number {
	return -0.5 * (p1.x - p2.x) * (p1.y + p2.y);
}

/**
 * [[utils.ts.sampleSegmentedFunction]]
 * 
 * @@ sampleSegmentedFunction
 * @desc - Sample a piecewise-linear function at `position`, with interpolation shaping
 * 
 * @param - array: points sorted by getX(value,index)
 * @param - getX: extract x value from element
 * @param - getY: extract y value from element
 * @param - interpolate: interpolation function (e.g. smoothstep)
 * @param - position: target x
 * 
 * @return - interpolated y value
 */
export function sampleSegmentedFunction<T>(
	array: T[],
	getX: (value: T, index: number) => number,
	getY: (value: T, index: number) => number,
	interpolate: (x: number) => number,
	position: number
): number {
	const pointIndex = binarySearchIndex(array, getX, position);
	const point = array[pointIndex];

	if (pointIndex > array.length - 2) return getY(point, pointIndex);
	const nextPoint = array[pointIndex + 1];

	return map(
		position,
		getX(point, pointIndex),
		getX(nextPoint, pointIndex + 1),
		interpolate,
		getY(point, pointIndex),
		getY(nextPoint, pointIndex + 1)
	);
}

/**
 * [[utils.ts.sampleAmplitudeMovingAverage]]
 * 
 * @@ sampleAmplitudeMovingAverage
 * 
 * @desc - Moving-average sample of amplitude curve around `position` over `windowSize` seconds
 * @note - Window = 0 returns direct segmented sampling
 * 
 * @param - {CurveEntry[]} amplitudeCurve: sorted by x
 * @param - {number} position: target time
 * @param - {number} windowSize: size of the window in seconds
 * 
 * @return - moving average amplitude
 */
export function sampleAmplitudeMovingAverage(amplitudeCurve: CurveEntry[], position: number, windowSize: number): number {
	if (windowSize == 0)
		return sampleSegmentedFunction(
			amplitudeCurve,
			e => e.x,
			e => e.y,
			x => x,
			position
		);

	const windowStart = position - windowSize / 2;
	const windowEnd = position + windowSize / 2;
	const windowStartIndex = binarySearchIndex(amplitudeCurve, e => e.x, windowStart);
	const windowEndIndex = binarySearchIndex(amplitudeCurve, e => e.x, windowEnd);

	let integral = 0;
	if (windowStartIndex == windowEndIndex) {
		const p1 = amplitudeCurve[windowStartIndex];

		if (windowStartIndex > amplitudeCurve.length - 2) return p1.y;
		const p2 = amplitudeCurve[windowStartIndex + 1];

		const yA = mapLinear(windowStart, p1.x, p2.x, p1.y, p2.y);
		const yB = mapLinear(windowEnd, p1.x, p2.x, p1.y, p2.y);

		return (yA + yB) / 2;
	} else {
		let p1 = amplitudeCurve[windowStartIndex];
		let p2 = amplitudeCurve[windowStartIndex + 1];

		let p = { x: windowStart, y: mapLinear(windowStart, p1.x, p2.x, p1.y, p2.y) };
		integral = integrateLinearSegment(p, p2);

		for (let i = windowStartIndex + 1; i < windowEndIndex; i++) {
			p1 = p2;
			p2 = amplitudeCurve[i + 1];

			integral += integrateLinearSegment(p1, p2);
		}

		p1 = p2;
		if (windowEndIndex > amplitudeCurve.length - 2) {
			integral += p1.y * (windowEnd - p1.x);
		} else {
			p2 = amplitudeCurve[windowEndIndex + 1];
			p = { x: windowEnd, y: mapLinear(windowEnd, p1.x, p2.x, p1.y, p2.y) };
			integral += integrateLinearSegment(p1, p);
		}
	}

	return integral / windowSize;
}

/**
 * [[utils.ts.sampleAccumulatedIntegral]]
 * 
 * @@ sampleAccumulatedIntegral
 * 
 * @desc - Accumulated integral at `position` for the amplitude curve
 * @whichmeans - Smooth “energy over time” used to drive animated noise offset
 * 
 * @param - {CurveEntry[]} amplitudeCurve: sorted by x
 * @param - {number} position: target time
 * 
 * @return - accumulated integral
 */
export function sampleAccumulatedIntegral(amplitudeCurve: CurveEntry[], position: number) {
	const index = binarySearchIndex(amplitudeCurve, e => e.x, position);
	const p1 = amplitudeCurve[index];

	if (index + 1 >= amplitudeCurve.length) return (p1.accumulatedIntegral ?? 0) + p1.y * (position - p1.x);

	const p2 = amplitudeCurve[index + 1];
	const mid = {
		x: position,
		y: mapLinear(position, p1.x, p2.x, p1.y, p2.y)
	};

	return (p1.accumulatedIntegral ?? 0) + integrateLinearSegment(p1, mid);
}

// @@ rgbToHsl
// @desc - Convert RGB [0, 255] to HSL [0, 1]
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
	r /= 255;
	g /= 255;
	b /= 255;
	const vmax = Math.max(r, g, b), vmin = Math.min(r, g, b);
	let h = 0, s = 0, l = (vmax + vmin) / 2;

	if (vmax !== vmin) {
		const d = vmax - vmin;
		s = l > 0.5 ? d / (2 - vmax - vmin) : d / (vmax + vmin);
		if (vmax === r) h = (g - b) / d + (g < b ? 6 : 0);
		else if (vmax === g) h = (b - r) / d + 2;
		else if (vmax === b) h = (r - g) / d + 4;
		h /= 6;
	}
	return [h, s, l];
}

// @@ hslToRgb
// @desc - Convert HSL [0, 1] to RGB [0, 255]
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	let r, g, b;

	if (s === 0) {
		r = g = b = l; // achromatic
	} else {
		const hue2rgb = (p: number, q: number, t: number) => {
			if (t < 0) t += 1;
			if (t > 1) t -= 1;
			if (t < 1 / 6) return p + (q - p) * 6 * t;
			if (t < 1 / 2) return q;
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
			return p;
		};
		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		r = hue2rgb(p, q, h + 1 / 3);
		g = hue2rgb(p, q, h);
		b = hue2rgb(p, q, h - 1 / 3);
	}
	return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

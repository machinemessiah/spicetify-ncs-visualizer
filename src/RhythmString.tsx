import { unzlibSync } from "fflate";

export type RhythmString = number[][];

// [[rhythm.parse]]
// @what - Parse Spotify rhythmstring (base64+zlib) into rhythm channels of absolute times
// @how - Base64 decode → zlib inflate → parse header (sampleRate, stepSize, channels) → cumulative sums
export function parseRhythmString(rhythmString: string): RhythmString {
	// @info - Replace URL-safe base64 into standard base64
	rhythmString = rhythmString.replace(/-/g, "+").replace(/_/g, "/");

	// @how - Decode to bytes and inflate with zlib
	const compressed = new Uint8Array(atob(rhythmString).split("").map(c => c.charCodeAt(0)));
	const decompressed = unzlibSync(compressed);

	const input = new TextDecoder().decode(decompressed).split(" ").map(s => parseInt(s));
	const output: number[][] = [];
	if (input.length < 3) return output;

	// @values - rhythm header
	// @value (sampleRate) - samples per second used when encoding rhythm steps
	// @value (stepSize) - number of samples per step; 1 step = stepSize / sampleRate seconds
	const sampleRate = input.shift()!;
	const stepSize = input.shift()!;
	const stepDuration = stepSize / sampleRate;

	// @value (channelCount) - number of independent rhythm channels
	const channelCount = input.shift()!;
	if (input.length < channelCount) return output;

	for (let i = 0; i < channelCount; i++) {
		const channel: number[] = [];
		// @value (entryCount) - number of deltas (in steps) in this channel
		const entryCount = input.shift()!;
		if (input.length < entryCount + (channelCount - i - 1)) return output;

		// @how - Convert step deltas to absolute seconds by cumulative sum
		for (let j = 0; j < entryCount; j++) {
			const entry = input.shift()! * stepDuration;
			channel.push(j == 0 ? entry : channel[j - 1] + entry);
		}

		output.push(channel);
	}

	return output;
}

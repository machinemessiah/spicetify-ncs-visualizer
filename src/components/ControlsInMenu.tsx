// [[menu.controls.inline]]
// [[@config.configStore.currentConfig]]
// [[@config.configStore.baseline]]
// [[@styles.studio.tune]]
// @when - 07-26-2026
// @what - Collapsible Tune-tab visualizer controls with per-field dirty/revert + live currentConfig persist
// @purpose - Preserve stepper precision while presenting a frosted glass control system

import React, { useMemo, useState } from "react";
import {
	VISUALIZER_DEFAULTS,
	type DotRadiusMode,
	type DotShape,
	type HypnoDirection,
	type LayoutMode,
	type LayoutSpinAxis,
	type LayoutSpinDirection,
	DOT_SHAPES,
	LAYOUT_MODES,
	LAYOUT_SPIN_AXES,
} from "../config/visualizer.defaults";
import {
	notifyVisualizerChanged,
	getBasedOn,
	getBaseline,
	isFieldDirty,
	isRangePartDirty,
	revertField,
	revertRangePart,
	revertAllToBaseline,
	countDirtyFields,
	type ConfigFieldKey,
	type RangePart,
} from "../config/configStore";
import styles from "../css/studio.module.scss";

type RangeKey = keyof typeof VISUALIZER_DEFAULTS;
const OVERLAY_SAMPLE_COUNT_MIN = 1;
const OVERLAY_SAMPLE_COUNT_MAX = 12;
const OVERLAY_OFFSET_STEP_DEG = 15;

// [[menu.controls.blurScale]]
// @what - friendly UI units for spatial blur (−150…150); storage keeps internal coeffs (−0.15…0.15)
// @how - UI = internal × 1000; default 0.01 → 10; step 1 UI = 0.001 internal
const BLUR_UI_MIN = -150;
const BLUR_UI_MAX = 150;
const BLUR_UI_SCALE = 1000;
const MULT_UI_MIN = -5;
const MULT_UI_MAX = 5;

// [[menu.controls.noiseOffsetScale]]
// @what - UI ×100 for noise scroll coeff; storage keeps internal (−5…5); default 0.75 → 75
const NOISE_OFFSET_UI_SCALE = 100;
const NOISE_OFFSET_UI_MIN = -500;
const NOISE_OFFSET_UI_MAX = 500;

// [[menu.controls.amplitudeWindow]]
// @what - UI ×1000 for loudness MA window (seconds); storage keeps [0,2]; default 0.05 → 50
const AMP_WINDOW_UI_SCALE = 1000;
const AMP_WINDOW_UI_MIN = 0;
const AMP_WINDOW_UI_MAX = 2000;

const CLEAR_AFTER_FRAMES_MIN = 1;
const CLEAR_AFTER_FRAMES_MAX = 512;
const BLUR_KERNEL_QUALITY_MIN = 1;
const BLUR_KERNEL_QUALITY_MAX = 64;

function blurToUi(internal: number): number {
	return Math.round(internal * BLUR_UI_SCALE);
}
function blurFromUi(ui: number): number {
	return ui / BLUR_UI_SCALE;
}
function clampBlurUi(ui: number): number {
	return Math.max(BLUR_UI_MIN, Math.min(BLUR_UI_MAX, ui));
}
function clampMult(v: number): number {
	return Math.max(MULT_UI_MIN, Math.min(MULT_UI_MAX, v));
}

function noiseOffsetToUi(internal: number): number {
	return Math.round(internal * NOISE_OFFSET_UI_SCALE);
}
function noiseOffsetFromUi(ui: number): number {
	return ui / NOISE_OFFSET_UI_SCALE;
}
function clampNoiseOffsetUi(ui: number): number {
	return Math.max(NOISE_OFFSET_UI_MIN, Math.min(NOISE_OFFSET_UI_MAX, ui));
}

function ampWindowToUi(internal: number): number {
	return Math.round(internal * AMP_WINDOW_UI_SCALE);
}
function ampWindowFromUi(ui: number): number {
	return ui / AMP_WINDOW_UI_SCALE;
}
function clampAmpWindowUi(ui: number): number {
	return Math.max(AMP_WINDOW_UI_MIN, Math.min(AMP_WINDOW_UI_MAX, ui));
}

function isRange(v: unknown): v is { min: number; max: number } {
	return !!v && typeof v === "object" && "min" in (v as object) && "max" in (v as object);
}

// @values - large-step levels for hypnoModeRefreshRate
const REFRESH_RATE_LEVELS = [30, 60, 75, 90, 100, 120, 144, 165, 240, 360];

// [[menu.controls.spinSpeedLevels]]
// @what - great-step snap levels for layoutSpinSpeed (revolutions per second)
const SPIN_SPEED_LEVELS = [0, 0.05, 0.1, 0.25, 0.5, 1, 2];
const SPIN_SPEED_MIN = 0;
const SPIN_SPEED_MAX = 2;
const ORIENT_DEG_MIN = 0;
const ORIENT_DEG_MAX = 360;
const ORIENT_FINE_STEP = 15;

// [[menu.controls.nearestRefreshRate]]
// @desc - returns the next refresh-rate level in the requested direction, clamped to [30, 360]
function nearestRefreshRate(current: number, direction: 1 | -1): number {
	const clamped = Math.max(30, Math.min(360, current));
	if (direction > 0) {
		const next = REFRESH_RATE_LEVELS.find((r) => r > clamped);
		return next ?? 360;
	}
	const prev = REFRESH_RATE_LEVELS.slice().reverse().find((r) => r < clamped);
	return prev ?? 30;
}

// [[menu.controls.nearestSpinSpeed]]
// @desc - next spin-speed snap level in the requested direction, clamped to [0, 2] rev/sec
function nearestSpinSpeed(current: number, direction: 1 | -1): number {
	const clamped = Math.max(SPIN_SPEED_MIN, Math.min(SPIN_SPEED_MAX, current));
	if (direction > 0) {
		const next = SPIN_SPEED_LEVELS.find((r) => r > clamped + 1e-9);
		return next ?? SPIN_SPEED_MAX;
	}
	const prev = SPIN_SPEED_LEVELS.slice().reverse().find((r) => r < clamped - 1e-9);
	return prev ?? SPIN_SPEED_MIN;
}

const Icon = React.memo((props: { name: Spicetify.Icon; size?: number }) => (
	<Spicetify.ReactComponent.IconComponent
		semanticColor="textBase"
		dangerouslySetInnerHTML={{ __html: Spicetify.SVGIcons[props.name] }}
		iconSize={props.size ?? 14}
	/>
));

function stepFor(key: string, value: number): number {
	if (key === "dotCount") {
		const aboveZero = value > 0;
		const belowZero = value <= 0;
		if (aboveZero && value <= 16) return 2;
		if (belowZero && value >= -16) return 2;
		if (aboveZero && value <= 32) return 4;
		if (belowZero && value >= -32) return 4;
		if (aboveZero && value <= 64) return 8;
		if (belowZero && value >= -64) return 8;
		if (aboveZero && value <= 128) return 16;
		if (belowZero && value >= -128) return 16;
		if (aboveZero && value <= 256) return 32;
		if (belowZero && value >= -256) return 32;
		if (aboveZero && value <= 512) return 64;
		if (belowZero && value >= -512) return 64;
		return 16;
	}
	if (key === "dotRadius") return 0.01;
	if (key === "multiplierLow" || key === "multiplierHigh") return 0.01;
	if (key === "blurX" || key === "blurY" || key === "blurBoth") return 1; // @note - UI units
	if (key === "noiseOffsetScale" || key === "amplitudeWindow") return 1; // @note - UI units
	if (key === "clearAfterFrames" || key === "blurKernelQuality") return 1;
	if (key === "motionBlur") return 0.01;
	if (key === "layoutSpinSpeed") return 0.01;
	if (key === "layoutOrientX" || key === "layoutOrientY" || key === "layoutOrientZ") return 1;
	if (key === "hypnoModeRefreshRate") return 1;
	if (key === "overlaySampleCount") return 1;
	return 0.1;
}

function fmt(key: string, v: number): string {
	if (key === "dotCount" || key === "hypnoModeRefreshRate" || key === "overlaySampleCount") return String(Math.round(v));
	if (key === "blurX" || key === "blurY" || key === "blurBoth") return String(Math.round(v));
	if (key === "noiseOffsetScale" || key === "amplitudeWindow" || key === "clearAfterFrames" || key === "blurKernelQuality") return String(Math.round(v));
	if (key === "layoutOrientX" || key === "layoutOrientY" || key === "layoutOrientZ") return String(Math.round(v));
	if (key === "motionBlur" || key === "dotRadius" || key === "multiplierLow" || key === "multiplierHigh" || key === "layoutSpinSpeed") return v.toFixed(2);
	return v.toFixed(1);
}

function prettyKey(key: string): string {
	return key.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function deltaLabel(key: string, live: number, base: number): string | null {
	if (live === base) return null;
	const d = live - base;
	const sign = d > 0 ? "+" : "";
	return `${sign}${fmt(key, d)}`;
}

// [[menu.controls.editableValue]]
// @what - click-to-edit numeric value inside the glass value well
function EditableValue({ value, keyName, onCommit }: { value: number; keyName: string; onCommit: (v: number) => void }) {
	const [isEditing, setIsEditing] = useState(false);
	const [tempVal, setTempVal] = useState(String(value));

	const handleCommit = () => {
		setIsEditing(false);
		if (tempVal === "" || tempVal === "-" || tempVal === ".") {
			setTempVal(fmt(keyName, value));
			return;
		}
		if (tempVal.startsWith(".") || tempVal.endsWith(".")) {
			setTempVal(fmt(keyName, value));
			return;
		}
		const num = parseFloat(tempVal);
		if (!isNaN(num)) {
			onCommit(num);
			setTempVal(fmt(keyName, num));
		} else {
			setTempVal(fmt(keyName, value));
		}
	};

	if (isEditing) {
		return (
			<input
				className={styles.valueWellInput}
				autoFocus
				value={tempVal}
				onChange={(e) => {
					const v = e.target.value;
					const regex = keyName === "dotCount" || keyName === "hypnoModeRefreshRate" || keyName === "overlaySampleCount" || keyName === "blurX" || keyName === "blurY" || keyName === "blurBoth" || keyName === "noiseOffsetScale" || keyName === "amplitudeWindow" || keyName === "clearAfterFrames" || keyName === "blurKernelQuality" || keyName === "layoutOrientX" || keyName === "layoutOrientY" || keyName === "layoutOrientZ" ? /^-?\d*$/ : /^-?\d*\.?\d*$/;
					if (v === "" || regex.test(v)) setTempVal(v);
				}}
				onBlur={handleCommit}
				onKeyDown={(e) => {
					if (e.key === "Enter") handleCommit();
					if (e.key === "Escape") {
						setIsEditing(false);
						setTempVal(fmt(keyName, value));
					}
				}}
			/>
		);
	}

	return (
		<span
			className={styles.valueWellText}
			onClick={(e) => {
				e.stopPropagation();
				setIsEditing(true);
				setTempVal(fmt(keyName, value));
			}}
		>
			{fmt(keyName, value)}
		</span>
	);
}

// @@ RevertChip
// @what - undo affordance using icon-revert-changes.svg; spacer preserves rail alignment when hidden
function RevertIcon() {
	return (
		<svg
			className={styles.icon}
			viewBox="0 0 48 48"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				d="M11.2721 36.7279C14.5294 39.9853 19.0294 42 24 42C33.9411 42 42 33.9411 42 24C42 14.0589 33.9411 6 24 6C19.0294 6 14.5294 8.01472 11.2721 11.2721C9.61407 12.9301 6 17 6 17"
				stroke="currentColor"
				strokeWidth="4"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M6 9V17H14"
				stroke="currentColor"
				strokeWidth="4"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function RevertChip(props: { show: boolean; onClick: () => void; label: string }) {
	if (!props.show) return <span className={styles.revertSpacer} aria-hidden="true" />;
	return (
		<button
			type="button"
			className={styles.revertBtn}
			onClick={(e) => { e.stopPropagation(); e.preventDefault(); props.onClick(); }}
			aria-label={props.label}
			title={props.label}
		>
			<RevertIcon />
		</button>
	);
}

type SectionId = "overlay" | "hypno" | "motion" | "blur" | "particles" | "layout" | "field";

// [[menu.controls.section]]
// [[@styles.studio.tuneCollapse]]
// @when - 07-29-2026
// @what - Accordion section: frosted header stays outside the collapse shell
// @why - header must stay clickable; content tucks under it via translate while height clips
// @how - children always mounted; grid 0fr/1fr = height; translateY on .tuneBody = slide-under feel
function Section(props: {
	id: SectionId;
	title: string;
	open: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}) {
	return (
		<div
			className={`${styles.tuneSection}${props.open ? ` ${styles.tuneOpen}` : ""}`}
			data-section={props.id}
		>
			<button
				type="button"
				className={styles.tuneSectionToggle}
				aria-expanded={props.open}
				onClick={(e) => {
					e.stopPropagation();
					e.preventDefault();
					props.onToggle();
				}}
			>
				<span className={styles.tuneSectionTitle}>{props.title}</span>
				{/* @what - circular glass chevron affordance (rotates when open) */}
				<span className={styles.tuneChevronBtn} aria-hidden="true">
					<span className={styles.tuneChevron}>▸</span>
				</span>
			</button>
			{/* @what - collapse shell; header stays outside so it never shrinks away */}
			<div className={styles.tuneCollapse}>
				<div className={styles.tuneCollapseInner}>
					<div className={styles.tuneBody}>{props.children}</div>
				</div>
			</div>
		</div>
	);
}

export default function ControlsInMenu(props: { onRequestSave?: () => void }) {
	const [version, setVersion] = useState(0);
	// @what - single source of truth for accordion open/closed (all start expanded)
	const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
		overlay: true,
		hypno: true,
		motion: true,
		blur: true,
		particles: true,
		layout: true,
		field: true,
	});

	const bump = () => {
		notifyVisualizerChanged();
		setVersion((x) => x + 1);
	};

	const basedOn = getBasedOn();
	const dirtyCount = useMemo(() => countDirtyFields(), [version]);
	const baseline = useMemo(() => getBaseline(), [version]);

	const overlaySampleCount = Number.isFinite(Number(window.visualizer?.overlaySampleCount))
		? Math.max(OVERLAY_SAMPLE_COUNT_MIN, Math.min(OVERLAY_SAMPLE_COUNT_MAX, Math.round(Number(window.visualizer.overlaySampleCount))))
		: 2;
	const overlayAngleOffsetDeg = Number.isFinite(Number(window.visualizer?.overlayAngleOffsetDeg))
		? Number(window.visualizer.overlayAngleOffsetDeg)
		: 0;
	const hasExplicitOverlayAngles = Array.isArray(window.visualizer?.overlayAnglesDeg) && window.visualizer.overlayAnglesDeg.length > 0;
	const hypnoMode = !!window.visualizer?.hypnoMode;
	const hypnoDirection: HypnoDirection = window.visualizer?.hypnoDirection === "alternate" ? "alternate" : "normal";
	const dotRadiusMode: DotRadiusMode = window.visualizer?.dotRadiusMode === "actual" ? "actual" : "spherical";
	const rawDotShape = window.visualizer?.dotShape;
	const dotShape: DotShape = (DOT_SHAPES as string[]).includes(rawDotShape as string)
		? (rawDotShape as DotShape)
		: VISUALIZER_DEFAULTS.dotShape;
	const rawLayoutMode = window.visualizer?.layoutMode;
	const layoutMode: LayoutMode = (LAYOUT_MODES as string[]).includes(rawLayoutMode as string)
		? (rawLayoutMode as LayoutMode)
		: VISUALIZER_DEFAULTS.layoutMode;
	const layoutSpinDirection: LayoutSpinDirection =
		window.visualizer?.layoutSpinDirection === "reverse" ? "reverse" : "normal";
	const rawSpinAxis = window.visualizer?.layoutSpinAxis;
	const layoutSpinAxis: LayoutSpinAxis = (LAYOUT_SPIN_AXES as string[]).includes(rawSpinAxis as string)
		? (rawSpinAxis as LayoutSpinAxis)
		: VISUALIZER_DEFAULTS.layoutSpinAxis;

	// @what - flip open/closed; content stays mounted so collapse can animate height + tuck
	const toggleSection = (id: SectionId) => {
		setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
	};

	const clearExplicitOverlayAngles = () => {
		window.visualizer.overlayAnglesDeg = [];
	};

	const setExactValue = (key: string, which: "min" | "max" | "value" | RangePart, newValue: number) => {
		const cur = (window.visualizer as any)[key];

		if (key === "motionBlur") {
			(window.visualizer as any)[key] = Math.max(0, Math.min(0.99, newValue));
			bump();
			return;
		}

		// @what - blur UI commits in friendly units; convert ÷1000 into stored coeffs
		if (key === "blurX" || key === "blurY") {
			(window.visualizer as any)[key] = blurFromUi(clampBlurUi(newValue));
			bump();
			return;
		}
		if (key === "blurBoth") {
			const v = blurFromUi(clampBlurUi(newValue));
			window.visualizer.blurX = v;
			window.visualizer.blurY = v;
			bump();
			return;
		}

		// @what - noiseOffsetScale UI ×100 → stored coeff
		if (key === "noiseOffsetScale") {
			(window.visualizer as any)[key] = noiseOffsetFromUi(clampNoiseOffsetUi(newValue));
			bump();
			return;
		}

		// @what - amplitudeWindow UI ×1000 → stored seconds
		if (key === "amplitudeWindow") {
			(window.visualizer as any)[key] = ampWindowFromUi(clampAmpWindowUi(newValue));
			bump();
			return;
		}

		if (key === "clearAfterFrames") {
			(window.visualizer as any)[key] = Math.max(
				CLEAR_AFTER_FRAMES_MIN,
				Math.min(CLEAR_AFTER_FRAMES_MAX, Math.round(newValue))
			);
			bump();
			return;
		}

		if (key === "blurKernelQuality") {
			(window.visualizer as any)[key] = Math.max(
				BLUR_KERNEL_QUALITY_MIN,
				Math.min(BLUR_KERNEL_QUALITY_MAX, Math.round(newValue))
			);
			bump();
			return;
		}

		if (key === "layoutSpinSpeed") {
			(window.visualizer as any)[key] = Math.max(
				SPIN_SPEED_MIN,
				Math.min(SPIN_SPEED_MAX, newValue)
			);
			bump();
			return;
		}

		if (key === "layoutOrientX" || key === "layoutOrientY" || key === "layoutOrientZ") {
			(window.visualizer as any)[key] = Math.max(
				ORIENT_DEG_MIN,
				Math.min(ORIENT_DEG_MAX, Math.round(newValue))
			);
			bump();
			return;
		}

		if (key === "hypnoModeRefreshRate") {
			(window.visualizer as any)[key] = Math.max(30, Math.min(360, newValue));
			bump();
			return;
		}

		if (key === "overlaySampleCount") {
			clearExplicitOverlayAngles();
			(window.visualizer as any)[key] = Math.max(
				OVERLAY_SAMPLE_COUNT_MIN,
				Math.min(OVERLAY_SAMPLE_COUNT_MAX, Math.round(newValue))
			);
			bump();
			return;
		}

		if (key === "overlayAngleOffsetDeg") {
			clearExplicitOverlayAngles();
			(window.visualizer as any)[key] = Number.isFinite(newValue) ? newValue : 0;
			bump();
			return;
		}

		if (which === "multiplierLow" || which === "multiplierHigh") {
			if (!cur || typeof cur !== "object") return;
			(window.visualizer as any)[key] = { ...cur, [which]: clampMult(newValue) };
			bump();
			return;
		}

		if (!isRange(cur)) return;
		const next = { ...cur, [which]: newValue } as { min: number; max: number };
		if (key === "dotCount") {
			next.min = Math.round(next.min);
			next.max = Math.round(next.max);
		}
		(window.visualizer as any)[key] = next;
		bump();
	};

	const adjust = (key: string, which: "min" | "max" | "value" | RangePart, delta: number) => {
		const cur = (window.visualizer as any)[key];

		if (key === "motionBlur") {
			let val = typeof cur === "number" ? cur : VISUALIZER_DEFAULTS.motionBlur;
			val = Math.max(0, Math.min(0.99, val + delta * stepFor(key, val)));
			(window.visualizer as any)[key] = val;
			bump();
			return;
		}

		// @how - step/great-step operate in UI units (−150…150), then write internal coeffs
		if (key === "blurX" || key === "blurY") {
			const ui = blurToUi(typeof cur === "number" ? cur : VISUALIZER_DEFAULTS.blurX);
			(window.visualizer as any)[key] = blurFromUi(clampBlurUi(ui + delta * stepFor(key, ui)));
			bump();
			return;
		}
		if (key === "blurBoth") {
			const ui = blurToUi(typeof window.visualizer.blurX === "number" ? window.visualizer.blurX : VISUALIZER_DEFAULTS.blurX);
			const next = blurFromUi(clampBlurUi(ui + delta * stepFor("blurBoth", ui)));
			window.visualizer.blurX = next;
			window.visualizer.blurY = next;
			bump();
			return;
		}

		if (key === "noiseOffsetScale") {
			const ui = noiseOffsetToUi(typeof cur === "number" ? cur : VISUALIZER_DEFAULTS.noiseOffsetScale);
			(window.visualizer as any)[key] = noiseOffsetFromUi(clampNoiseOffsetUi(ui + delta * stepFor(key, ui)));
			bump();
			return;
		}

		if (key === "amplitudeWindow") {
			const ui = ampWindowToUi(typeof cur === "number" ? cur : VISUALIZER_DEFAULTS.amplitudeWindow);
			(window.visualizer as any)[key] = ampWindowFromUi(clampAmpWindowUi(ui + delta * stepFor(key, ui)));
			bump();
			return;
		}

		if (key === "clearAfterFrames") {
			let val = typeof cur === "number" ? cur : VISUALIZER_DEFAULTS.clearAfterFrames;
			val = Math.max(CLEAR_AFTER_FRAMES_MIN, Math.min(CLEAR_AFTER_FRAMES_MAX, Math.round(val + delta * stepFor(key, val))));
			(window.visualizer as any)[key] = val;
			bump();
			return;
		}

		if (key === "blurKernelQuality") {
			let val = typeof cur === "number" ? cur : VISUALIZER_DEFAULTS.blurKernelQuality;
			val = Math.max(BLUR_KERNEL_QUALITY_MIN, Math.min(BLUR_KERNEL_QUALITY_MAX, Math.round(val + delta * stepFor(key, val))));
			(window.visualizer as any)[key] = val;
			bump();
			return;
		}

		if (key === "layoutSpinSpeed") {
			let val = typeof cur === "number" ? cur : VISUALIZER_DEFAULTS.layoutSpinSpeed;
			let nextVal: number;
			if (Math.abs(delta) === 10) {
				nextVal = nearestSpinSpeed(val, delta > 0 ? 1 : -1);
			} else {
				nextVal = val + delta * stepFor(key, val);
			}
			(window.visualizer as any)[key] = Math.max(SPIN_SPEED_MIN, Math.min(SPIN_SPEED_MAX, nextVal));
			bump();
			return;
		}

		if (key === "layoutOrientX" || key === "layoutOrientY" || key === "layoutOrientZ") {
			let val = typeof cur === "number" ? cur : Number((VISUALIZER_DEFAULTS as any)[key] ?? 0);
			// @how - fine buttons pass ±10 → jump by ORIENT_FINE_STEP (15°); normal step is 1°
			const step = Math.abs(delta) === 10 ? ORIENT_FINE_STEP : stepFor(key, val);
			const nextVal = Math.round(val + (delta > 0 ? step : -step));
			(window.visualizer as any)[key] = Math.max(ORIENT_DEG_MIN, Math.min(ORIENT_DEG_MAX, nextVal));
			bump();
			return;
		}

		if (key === "hypnoModeRefreshRate") {
			let val = typeof cur === "number" ? cur : VISUALIZER_DEFAULTS.hypnoModeRefreshRate;
			let nextVal: number;
			if (Math.abs(delta) === 10) {
				nextVal = nearestRefreshRate(val, delta > 0 ? 1 : -1);
			} else {
				nextVal = val + delta * stepFor(key, val);
			}
			(window.visualizer as any)[key] = Math.max(30, Math.min(360, nextVal));
			bump();
			return;
		}

		if (key === "overlaySampleCount") {
			clearExplicitOverlayAngles();
			const dir = delta > 0 ? 1 : -1;
			(window.visualizer as any)[key] = Math.max(
				OVERLAY_SAMPLE_COUNT_MIN,
				Math.min(OVERLAY_SAMPLE_COUNT_MAX, overlaySampleCount + dir)
			);
			bump();
			return;
		}

		if (key === "overlayAngleOffsetDeg") {
			clearExplicitOverlayAngles();
			const dir = delta > 0 ? 1 : -1;
			(window.visualizer as any)[key] = overlayAngleOffsetDeg + (dir * OVERLAY_OFFSET_STEP_DEG);
			bump();
			return;
		}

		if (which === "multiplierLow" || which === "multiplierHigh") {
			if (!cur || typeof cur !== "object") return;
			const live = Number(cur[which] ?? (VISUALIZER_DEFAULTS.dotRadius as any)[which] ?? 1);
			const next = clampMult(live + delta * stepFor(which, live));
			(window.visualizer as any)[key] = { ...cur, [which]: next };
			bump();
			return;
		}

		if (!isRange(cur)) return;
		const rangeWhich = which as "min" | "max";
		const s = stepFor(key, cur[rangeWhich]);
		const next = { ...cur, [which]: cur[rangeWhich] + delta * s } as { min: number; max: number };
		if (key === "dotCount") {
			next.min = Math.round(next.min);
			next.max = Math.round(next.max);
		}
		(window.visualizer as any)[key] = next;
		bump();
	};

	const renderScalarCard = (
		key: "motionBlur" | "hypnoModeRefreshRate" | "overlaySampleCount" | "overlayAngleOffsetDeg" | "clearAfterFrames" | "blurKernelQuality" | "noiseOffsetScale" | "amplitudeWindow" | "layoutSpinSpeed" | "layoutOrientX" | "layoutOrientY" | "layoutOrientZ",
		title?: string
	) => {
		const raw = (window.visualizer as any)[key];
		let stored = typeof raw === "number" ? raw : Number((VISUALIZER_DEFAULTS as any)[key]);
		if (key === "overlaySampleCount") stored = overlaySampleCount;
		if (key === "overlayAngleOffsetDeg") stored = overlayAngleOffsetDeg;

		// @what - scaled knobs display/edit in friendly UI units; storage stays internal
		const usesNoiseUi = key === "noiseOffsetScale";
		const usesAmpUi = key === "amplitudeWindow";
		const isOrient = key === "layoutOrientX" || key === "layoutOrientY" || key === "layoutOrientZ";
		const val = usesNoiseUi
			? noiseOffsetToUi(stored)
			: usesAmpUi
				? ampWindowToUi(stored)
				: stored;
		const baseStored = Number((baseline as any)[key]);
		const baseVal = usesNoiseUi
			? noiseOffsetToUi(baseStored)
			: usesAmpUi
				? ampWindowToUi(baseStored)
				: baseStored;
		const dirty = isFieldDirty(key as ConfigFieldKey);
		const delta = deltaLabel(key, val, baseVal);
		const pretty = title ?? prettyKey(key);
		const showFine = key === "hypnoModeRefreshRate" || key === "motionBlur" || key === "clearAfterFrames" || key === "blurKernelQuality" || key === "layoutSpinSpeed" || isOrient || usesNoiseUi || usesAmpUi;

		return (
			<div className={`${styles.tuneCard}${dirty ? ` ${styles.tuneCardDirty}` : ""}`}>
				<div className={styles.tuneHeader}>
					<span className={styles.tuneTitle}>{pretty}</span>
					<span className={styles.valuePill}>
						{key === "overlayAngleOffsetDeg" || isOrient ? `${fmt(key, val)}deg` : fmt(key, val)}
					</span>
				</div>
				<div className={`${styles.line}${dirty ? ` ${styles.lineDirty}` : ""}`}>
					<span className={styles.label}>value</span>
					{/* @what - inset glass rail: fine-step · − · value well · + · fine-step */}
					<div className={styles.stepperRail}>
						{showFine ? (
							<button
								type="button"
								className={`${styles.stepBtn} ${styles.stepBtnGhost}`}
								onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, "value", -10); }}
								aria-label={`greatly decrease ${pretty}`}
							>
								<span className={styles.icon}><Icon name="block" /></span>
							</button>
						) : null}
						<button
							type="button"
							className={styles.stepBtn}
							onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, "value", -1); }}
							aria-label={`decrease ${pretty}`}
						>
							<span className={styles.icon}><Icon name="minus" /></span>
						</button>
						<div className={styles.valueWell}>
							<EditableValue value={val} keyName={key} onCommit={(v) => setExactValue(key, "value", v)} />
							{delta ? <span className={styles.delta}>{delta}</span> : null}
						</div>
						<button
							type="button"
							className={styles.stepBtn}
							onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, "value", +1); }}
							aria-label={`increase ${pretty}`}
						>
							<span className={styles.icon}><Icon name="plus2px" /></span>
						</button>
						{showFine ? (
							<button
								type="button"
								className={`${styles.stepBtn} ${styles.stepBtnGhost}`}
								onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, "value", +10); }}
								aria-label={`greatly increase ${pretty}`}
							>
								<span className={styles.icon}><Icon name="plus-alt" /></span>
							</button>
						) : null}
					</div>
					<RevertChip
						show={dirty}
						label={`revert ${pretty}`}
						onClick={() => { revertField(key as ConfigFieldKey); setVersion((x) => x + 1); }}
					/>
				</div>
			</div>
		);
	};

	// [[menu.controls.blurCard]]
	// @what - spatial blur stepper in UI units (−150…150); mode both|x|y
	// @how - EditableValue/steps use UI ints; setExactValue/adjust convert to internal coeffs
	const renderBlurCard = (mode: "both" | "x" | "y") => {
		const liveX = typeof window.visualizer?.blurX === "number" ? window.visualizer.blurX : VISUALIZER_DEFAULTS.blurX;
		const liveY = typeof window.visualizer?.blurY === "number" ? window.visualizer.blurY : VISUALIZER_DEFAULTS.blurY;
		const baseX = Number((baseline as any).blurX ?? VISUALIZER_DEFAULTS.blurX);
		const baseY = Number((baseline as any).blurY ?? VISUALIZER_DEFAULTS.blurY);
		const axesDiffer = liveX !== liveY;

		const storeKey = mode === "both" ? "blurBoth" : mode === "x" ? "blurX" : "blurY";
		const fieldKey: ConfigFieldKey | null = mode === "both" ? null : mode === "x" ? "blurX" : "blurY";
		const uiLive = blurToUi(mode === "y" ? liveY : liveX);
		const uiBase = blurToUi(mode === "y" ? baseY : baseX);
		const dirty = mode === "both"
			? isFieldDirty("blurX") || isFieldDirty("blurY")
			: isFieldDirty(fieldKey!);
		const delta = deltaLabel(storeKey, uiLive, uiBase);
		const title = mode === "both" ? "Both axes" : mode === "x" ? "Blur X" : "Blur Y";
		const matchLabel = mode === "x" ? "Match Y" : mode === "y" ? "Match X" : null;

		return (
			<div className={`${styles.tuneCard}${dirty ? ` ${styles.tuneCardDirty}` : ""}`}>
				<div className={styles.tuneHeader}>
					<span className={styles.tuneTitle}>{title}</span>
					<span className={styles.valuePill}>
						{mode === "both" && axesDiffer ? `${blurToUi(liveX)} / ${blurToUi(liveY)}` : fmt(storeKey, uiLive)}
					</span>
				</div>
				<div className={`${styles.line}${dirty ? ` ${styles.lineDirty}` : ""}`}>
					<span className={styles.label}>{mode === "both" ? "both" : mode}</span>
					<div className={styles.stepperRail}>
						<button
							type="button"
							className={`${styles.stepBtn} ${styles.stepBtnGhost}`}
							onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(storeKey, "value", -10); }}
							aria-label={`greatly decrease ${title}`}
						>
							<span className={styles.icon}><Icon name="block" /></span>
						</button>
						<button
							type="button"
							className={styles.stepBtn}
							onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(storeKey, "value", -1); }}
							aria-label={`decrease ${title}`}
						>
							<span className={styles.icon}><Icon name="minus" /></span>
						</button>
						<div className={styles.valueWell}>
							{/* @note - EditableValue sees UI units; commit path divides by 1000 */}
							<EditableValue value={uiLive} keyName={storeKey} onCommit={(v) => setExactValue(storeKey, "value", v)} />
							{delta ? <span className={styles.delta}>{delta}</span> : null}
						</div>
						<button
							type="button"
							className={styles.stepBtn}
							onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(storeKey, "value", +1); }}
							aria-label={`increase ${title}`}
						>
							<span className={styles.icon}><Icon name="plus2px" /></span>
						</button>
						<button
							type="button"
							className={`${styles.stepBtn} ${styles.stepBtnGhost}`}
							onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(storeKey, "value", +10); }}
							aria-label={`greatly increase ${title}`}
						>
							<span className={styles.icon}><Icon name="plus-alt" /></span>
						</button>
					</div>
					{mode === "both" ? (
						<span className={styles.revertSpacer} aria-hidden="true" />
					) : (
						<RevertChip
							show={dirty}
							label={`revert ${title}`}
							onClick={() => { revertField(fieldKey!); setVersion((x) => x + 1); }}
						/>
					)}
				</div>
				{matchLabel ? (
					<button
						type="button"
						className={styles.sessionCapsule}
						onClick={(e) => {
							e.stopPropagation();
							e.preventDefault();
							// @what - instantly copy the other axis onto this one
							if (mode === "x") window.visualizer.blurX = window.visualizer.blurY;
							else window.visualizer.blurY = window.visualizer.blurX;
							bump();
						}}
					>
						{matchLabel}
					</button>
				) : null}
				{mode === "both" && dirty ? (
					<button
						type="button"
						className={styles.sessionCapsule}
						onClick={(e) => {
							e.stopPropagation();
							e.preventDefault();
							revertField("blurX");
							revertField("blurY");
							setVersion((x) => x + 1);
						}}
					>
						Revert both
					</button>
				) : null}
			</div>
		);
	};

	const renderRangeCard = (key: RangeKey, title?: string) => {
		const rawValue = (window.visualizer as any)[key];
		let value = rawValue;
		if (!isRange(value)) {
			value = (VISUALIZER_DEFAULTS as any)[key];
			if (!isRange(value)) return null;
		}
		const baseRange = (baseline as any)[key];
		const dirty = isFieldDirty(key as ConfigFieldKey);
		const pretty = title ?? prettyKey(key);
		const minDirty = isRangePartDirty(key as ConfigFieldKey, "min");
		const maxDirty = isRangePartDirty(key as ConfigFieldKey, "max");
		const minDelta = isRange(baseRange) ? deltaLabel(key, value.min, baseRange.min) : null;
		const maxDelta = isRange(baseRange) ? deltaLabel(key, value.max, baseRange.max) : null;

		return (
			<div key={key} className={`${styles.tuneCard}${dirty ? ` ${styles.tuneCardDirty}` : ""}`}>
				<div className={styles.tuneHeader}>
					<span className={styles.tuneTitle}>{pretty}</span>
					<span className={styles.valuePill}>{fmt(key, value.min)} → {fmt(key, value.max)}</span>
				</div>
				{key === "dotRadius" ? (
					<div className={`${styles.line}${isFieldDirty("dotRadiusMode") ? ` ${styles.lineDirty}` : ""}`}>
						<span className={styles.label}>mode</span>
						<div className={styles.segmentTrack} role="group">
							<button
								type="button"
								className={`${styles.segmentPill}${dotRadiusMode === "actual" ? ` ${styles.segmentPillActive}` : ""}`}
								onClick={(e) => {
									e.stopPropagation();
									e.preventDefault();
									window.visualizer.dotRadiusMode = "actual";
									bump();
								}}
							>
								actual
							</button>
							<button
								type="button"
								className={`${styles.segmentPill}${dotRadiusMode === "spherical" ? ` ${styles.segmentPillActive}` : ""}`}
								onClick={(e) => {
									e.stopPropagation();
									e.preventDefault();
									window.visualizer.dotRadiusMode = "spherical";
									bump();
								}}
							>
								spherical
							</button>
						</div>
						<RevertChip
							show={isFieldDirty("dotRadiusMode")}
							label="revert dot radius mode"
							onClick={() => { revertField("dotRadiusMode"); setVersion((x) => x + 1); }}
						/>
					</div>
				) : null}
				{(["min", "max"] as const).map((which) => {
					const partDirty = which === "min" ? minDirty : maxDirty;
					const partDelta = which === "min" ? minDelta : maxDelta;
					return (
						<div key={which} className={`${styles.line}${partDirty ? ` ${styles.lineDirty}` : ""}`}>
							<span className={styles.label}>{which}</span>
							<div className={styles.stepperRail}>
								<button
									type="button"
									className={`${styles.stepBtn} ${styles.stepBtnGhost}`}
									onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, which, -10); }}
									aria-label={`greatly decrease ${pretty} ${which}`}
								>
									<span className={styles.icon}><Icon name="block" /></span>
								</button>
								<button
									type="button"
									className={styles.stepBtn}
									onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, which, -1); }}
									aria-label={`decrease ${pretty} ${which}`}
								>
									<span className={styles.icon}><Icon name="minus" /></span>
								</button>
								<div className={styles.valueWell}>
									<EditableValue value={value[which]} keyName={key} onCommit={(v) => setExactValue(key, which, v)} />
									{partDelta ? <span className={styles.delta}>{partDelta}</span> : null}
								</div>
								<button
									type="button"
									className={styles.stepBtn}
									onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, which, +1); }}
									aria-label={`increase ${pretty} ${which}`}
								>
									<span className={styles.icon}><Icon name="plus2px" /></span>
								</button>
								<button
									type="button"
									className={`${styles.stepBtn} ${styles.stepBtnGhost}`}
									onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, which, +10); }}
									aria-label={`greatly increase ${pretty} ${which}`}
								>
									<span className={styles.icon}><Icon name="plus-alt" /></span>
								</button>
							</div>
							<RevertChip
								show={partDirty}
								label={`revert ${pretty} ${which}`}
								onClick={() => { revertRangePart(key as ConfigFieldKey, which); setVersion((x) => x + 1); }}
							/>
						</div>
					);
				})}
				{/* @what - spherical-path clamp multipliers (unused when mode is actual) */}
				{key === "dotRadius" && dotRadiusMode === "spherical" ? (
					(["multiplierLow", "multiplierHigh"] as const).map((which) => {
						const liveMult = Number((value as any)[which] ?? (VISUALIZER_DEFAULTS.dotRadius as any)[which] ?? 1);
						const baseMult = Number((baseRange as any)?.[which] ?? (VISUALIZER_DEFAULTS.dotRadius as any)[which] ?? 1);
						const partDirty = isRangePartDirty("dotRadius", which);
						const partDelta = deltaLabel(which, liveMult, baseMult);
						const label = which === "multiplierLow" ? "mult low" : "mult high";
						return (
							<div key={which} className={`${styles.line}${partDirty ? ` ${styles.lineDirty}` : ""}`}>
								<span className={styles.label}>{label}</span>
								<div className={styles.stepperRail}>
									<button
										type="button"
										className={`${styles.stepBtn} ${styles.stepBtnGhost}`}
										onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust("dotRadius", which, -10); }}
										aria-label={`greatly decrease ${label}`}
									>
										<span className={styles.icon}><Icon name="block" /></span>
									</button>
									<button
										type="button"
										className={styles.stepBtn}
										onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust("dotRadius", which, -1); }}
										aria-label={`decrease ${label}`}
									>
										<span className={styles.icon}><Icon name="minus" /></span>
									</button>
									<div className={styles.valueWell}>
										<EditableValue value={liveMult} keyName={which} onCommit={(v) => setExactValue("dotRadius", which, v)} />
										{partDelta ? <span className={styles.delta}>{partDelta}</span> : null}
									</div>
									<button
										type="button"
										className={styles.stepBtn}
										onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust("dotRadius", which, +1); }}
										aria-label={`increase ${label}`}
									>
										<span className={styles.icon}><Icon name="plus2px" /></span>
									</button>
									<button
										type="button"
										className={`${styles.stepBtn} ${styles.stepBtnGhost}`}
										onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust("dotRadius", which, +10); }}
										aria-label={`greatly increase ${label}`}
									>
										<span className={styles.icon}><Icon name="plus-alt" /></span>
									</button>
								</div>
								<RevertChip
									show={partDirty}
									label={`revert ${label}`}
									onClick={() => { revertRangePart("dotRadius", which); setVersion((x) => x + 1); }}
								/>
							</div>
						);
					})
				) : null}
			</div>
		);
	};

	return (
		<div className={styles.tuneRoot}>
			{/* [[menu.controls.sessionHeader]] */}
			{/* @what - floating glass session strip: meta + capsule actions */}
			<div className={styles.sessionBar}>
				<div className={styles.sessionMeta}>
					<span className={`${styles.basedOn}${basedOn ? "" : ` ${styles.basedOnUnsaved}`}`}>
						{basedOn ?? "[ unsaved ]"}
					</span>
					{dirtyCount > 0 ? (
						<span className={styles.dirtyBadge}>{dirtyCount} changed</span>
					) : null}
				</div>
				<div className={styles.sessionActions}>
					<button
						type="button"
						className={styles.sessionCapsule}
						disabled={dirtyCount === 0}
						onClick={(e) => {
							e.stopPropagation();
							e.preventDefault();
							revertAllToBaseline();
							setVersion((x) => x + 1);
						}}
					>
						Restore
					</button>
					<button
						type="button"
						className={`${styles.sessionCapsule} ${styles.sessionCapsulePrimary}`}
						onClick={(e) => {
							e.stopPropagation();
							e.preventDefault();
							props.onRequestSave?.();
						}}
					>
						Save…
					</button>
				</div>
			</div>

			<Section id="overlay" title="Overlay" open={openSections.overlay} onToggle={() => toggleSection("overlay")}>
				{renderScalarCard("overlaySampleCount", "Overlay Copies")}
				{renderScalarCard("overlayAngleOffsetDeg", "Overlay Offset")}
				{hasExplicitOverlayAngles ? (
					<div className={styles.tuneCard}>
						<button
							type="button"
							className={styles.sessionCapsule}
							onClick={(e) => {
								e.stopPropagation();
								e.preventDefault();
								clearExplicitOverlayAngles();
								bump();
							}}
						>
							Use Evenly Spaced Angles
						</button>
					</div>
				) : null}
			</Section>

			<Section id="hypno" title="Hypno" open={openSections.hypno} onToggle={() => toggleSection("hypno")}>
				<div className={`${styles.tuneCard}${isFieldDirty("hypnoMode") || isFieldDirty("hypnoDirection") ? ` ${styles.tuneCardDirty}` : ""}`}>
					<div className={`${styles.line}${isFieldDirty("hypnoMode") ? ` ${styles.lineDirty}` : ""}`}>
						<span className={styles.label}>mode</span>
						<div className={styles.segmentTrack} role="group">
							<button
								type="button"
								className={`${styles.segmentPill}${hypnoMode ? ` ${styles.segmentPillActive}` : ""}`}
								onClick={(e) => {
									e.stopPropagation();
									e.preventDefault();
									window.visualizer.hypnoMode = true;
									bump();
								}}
							>
								on
							</button>
							<button
								type="button"
								className={`${styles.segmentPill}${!hypnoMode ? ` ${styles.segmentPillActive}` : ""}`}
								onClick={(e) => {
									e.stopPropagation();
									e.preventDefault();
									window.visualizer.hypnoMode = false;
									bump();
								}}
							>
								off
							</button>
						</div>
						<RevertChip
							show={isFieldDirty("hypnoMode")}
							label="revert hypno mode"
							onClick={() => { revertField("hypnoMode"); setVersion((x) => x + 1); }}
						/>
					</div>
					<div className={`${styles.line}${isFieldDirty("hypnoDirection") ? ` ${styles.lineDirty}` : ""}`}>
						<span className={styles.label}>direction</span>
						<div className={styles.segmentTrack} role="group">
							<button
								type="button"
								className={`${styles.segmentPill}${hypnoDirection === "normal" ? ` ${styles.segmentPillActive}` : ""}`}
								onClick={(e) => {
									e.stopPropagation();
									e.preventDefault();
									window.visualizer.hypnoDirection = "normal";
									window.visualizerHypnoDirection = true;
									bump();
								}}
							>
								normal
							</button>
							<button
								type="button"
								className={`${styles.segmentPill}${hypnoDirection === "alternate" ? ` ${styles.segmentPillActive}` : ""}`}
								onClick={(e) => {
									e.stopPropagation();
									e.preventDefault();
									window.visualizer.hypnoDirection = "alternate";
									window.visualizerHypnoDirection = false;
									bump();
								}}
							>
								alternate
							</button>
						</div>
						<RevertChip
							show={isFieldDirty("hypnoDirection")}
							label="revert hypno direction"
							onClick={() => { revertField("hypnoDirection"); setVersion((x) => x + 1); }}
						/>
					</div>
				</div>
				{renderScalarCard("hypnoModeRefreshRate", "Refresh Rate")}
			</Section>

			<Section id="motion" title="Motion" open={openSections.motion} onToggle={() => toggleSection("motion")}>
				{renderScalarCard("motionBlur")}
				{renderScalarCard("clearAfterFrames", "Clear After Frames")}
			</Section>

			{/* [[menu.controls.blurSection]] */}
			{/* @what - spatial particle blur (separate from temporal motionBlur) */}
			<Section id="blur" title="Blur" open={openSections.blur} onToggle={() => toggleSection("blur")}>
				{renderBlurCard("both")}
				{renderBlurCard("x")}
				{renderBlurCard("y")}
				{renderScalarCard("blurKernelQuality", "Kernel Quality")}
			</Section>

			<Section id="particles" title="Particles" open={openSections.particles} onToggle={() => toggleSection("particles")}>
				{/* [[menu.controls.dotShape]] */}
				{/* @what - particle glyph silhouette; SDF only — radius/count/spacing unchanged */}
				<div className={`${styles.tuneCard}${isFieldDirty("dotShape") ? ` ${styles.tuneCardDirty}` : ""}`}>
					<div className={styles.tuneHeader}>
						<span className={styles.tuneTitle}>Shape</span>
						<span className={styles.valuePill}>{dotShape}</span>
					</div>
					<div className={`${styles.line}${isFieldDirty("dotShape") ? ` ${styles.lineDirty}` : ""}`}>
						<span className={styles.label}>glyph</span>
						<div className={`${styles.segmentTrack} ${styles.segmentTrackWrap}`} role="group">
							{DOT_SHAPES.map((shape) => (
								<button
									key={shape}
									type="button"
									data-shape={shape}
									aria-label={shape}
									title={shape}
									className={`${styles.segmentPill}${dotShape === shape ? ` ${styles.segmentPillActive}` : ""}`}
									onClick={(e) => {
										e.stopPropagation();
										e.preventDefault();
										window.visualizer.dotShape = shape;
										bump();
									}}
								>
									{/* @what - CSS outline glyph; config value remains the text name */}
									<span className={styles.shapeGlyph} data-shape={shape} aria-hidden="true" />
								</button>
							))}
						</div>
						<RevertChip
							show={isFieldDirty("dotShape")}
							label="revert particle shape"
							onClick={() => { revertField("dotShape"); setVersion((x) => x + 1); }}
						/>
					</div>
				</div>
				{renderRangeCard("dotCount")}
				{renderRangeCard("dotRadius")}
				{renderRangeCard("dotSpacing")}
				{renderRangeCard("dotOffset")}
			</Section>

			{/* [[menu.controls.layoutSection]] */}
			{/* @what - 3D layout map + continuous tumble (before orthographic XY drop) */}
			<Section id="layout" title="Layout" open={openSections.layout} onToggle={() => toggleSection("layout")}>
				<div className={`${styles.tuneCard}${isFieldDirty("layoutMode") ? ` ${styles.tuneCardDirty}` : ""}`}>
					<div className={styles.tuneHeader}>
						<span className={styles.tuneTitle}>Mode</span>
						<span className={styles.valuePill}>{layoutMode}</span>
					</div>
					<div className={`${styles.line}${isFieldDirty("layoutMode") ? ` ${styles.lineDirty}` : ""}`}>
						<span className={styles.label}>map</span>
						<div className={`${styles.segmentTrack} ${styles.segmentTrackWrap}`} role="group">
							{LAYOUT_MODES.map((mode) => (
								<button
									key={mode}
									type="button"
									className={`${styles.segmentPill}${layoutMode === mode ? ` ${styles.segmentPillActive}` : ""}`}
									onClick={(e) => {
										e.stopPropagation();
										e.preventDefault();
										window.visualizer.layoutMode = mode;
										bump();
									}}
								>
									{mode}
								</button>
							))}
						</div>
						<RevertChip
							show={isFieldDirty("layoutMode")}
							label="revert layout mode"
							onClick={() => { revertField("layoutMode"); setVersion((x) => x + 1); }}
						/>
					</div>
				</div>

				<div className={`${styles.tuneCard}${isFieldDirty("layoutSpinAxis") ? ` ${styles.tuneCardDirty}` : ""}`}>
					<div className={styles.tuneHeader}>
						<span className={styles.tuneTitle}>Spin Axis</span>
						<span className={styles.valuePill}>{layoutSpinAxis}</span>
					</div>
					<div className={`${styles.line}${isFieldDirty("layoutSpinAxis") ? ` ${styles.lineDirty}` : ""}`}>
						<span className={styles.label}>axis</span>
						<div className={styles.segmentTrack} role="group">
							{LAYOUT_SPIN_AXES.map((axis) => (
								<button
									key={axis}
									type="button"
									className={`${styles.segmentPill}${layoutSpinAxis === axis ? ` ${styles.segmentPillActive}` : ""}`}
									onClick={(e) => {
										e.stopPropagation();
										e.preventDefault();
										window.visualizer.layoutSpinAxis = axis;
										bump();
									}}
								>
									{axis}
								</button>
							))}
						</div>
						<RevertChip
							show={isFieldDirty("layoutSpinAxis")}
							label="revert spin axis"
							onClick={() => { revertField("layoutSpinAxis"); setVersion((x) => x + 1); }}
						/>
					</div>
				</div>

				<div className={`${styles.tuneCard}${isFieldDirty("layoutSpinDirection") ? ` ${styles.tuneCardDirty}` : ""}`}>
					<div className={styles.tuneHeader}>
						<span className={styles.tuneTitle}>Spin Direction</span>
						<span className={styles.valuePill}>{layoutSpinDirection}</span>
					</div>
					<div className={`${styles.line}${isFieldDirty("layoutSpinDirection") ? ` ${styles.lineDirty}` : ""}`}>
						<span className={styles.label}>dir</span>
						<div className={styles.segmentTrack} role="group">
							{(["normal", "reverse"] as LayoutSpinDirection[]).map((dir) => (
								<button
									key={dir}
									type="button"
									className={`${styles.segmentPill}${layoutSpinDirection === dir ? ` ${styles.segmentPillActive}` : ""}`}
									onClick={(e) => {
										e.stopPropagation();
										e.preventDefault();
										window.visualizer.layoutSpinDirection = dir;
										bump();
									}}
								>
									{dir}
								</button>
							))}
						</div>
						<RevertChip
							show={isFieldDirty("layoutSpinDirection")}
							label="revert spin direction"
							onClick={() => { revertField("layoutSpinDirection"); setVersion((x) => x + 1); }}
						/>
					</div>
				</div>

				{renderScalarCard("layoutSpinSpeed", "Spin Speed")}
				{/* @what - stationary pose (degrees); applied before continuous spin */}
				{renderScalarCard("layoutOrientX", "Orient X")}
				{renderScalarCard("layoutOrientY", "Orient Y")}
				{renderScalarCard("layoutOrientZ", "Orient Z")}
			</Section>

			<Section id="field" title="Field" open={openSections.field} onToggle={() => toggleSection("field")}>
				{renderRangeCard("sphereRadius", "Radius")}
				{renderRangeCard("noiseAmplitude")}
				{renderRangeCard("noiseFrequency")}
				{renderScalarCard("noiseOffsetScale", "Noise Offset Scale")}
				{renderScalarCard("amplitudeWindow", "Amplitude Window")}
				{renderRangeCard("feather")}
			</Section>
		</div>
	);
}

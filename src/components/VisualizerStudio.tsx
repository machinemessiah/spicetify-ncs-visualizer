// [[components.visualizerStudio]]
// [[@styles.studio]]
// [[@config.configStore]]
// @when - 07-27-2026
// @what - Custom right-dock Studio panel replacing the Spicetify ContextMenu host
// @purpose - Room for Tune / Library / Style while the visualizer stays visible on the left stage

import React, { useCallback, useEffect, useMemo, useState } from "react";
import ControlsInMenu from "./ControlsInMenu";
import {
	StudioConfigsList,
	StudioCreateNewButton,
	StudioSaveSheet,
} from "./ConfigManager";
import { notifyVisualizerChanged } from "../config/configStore";
import styles from "../css/studio.module.scss";

type OverlayBlendMode = typeof import("../config/visualizer.defaults").VISUALIZER_DEFAULTS["overlayBlendMode"];

export type StudioTab = "tune" | "library" | "style";

const OVERLAY_BLEND_MODE_OPTIONS: { mode: OverlayBlendMode; label: string }[] = [
	{ mode: "alpha_mix", label: "Linear Alpha Mix" },
	{ mode: "additive", label: "Additive" },
	{ mode: "max", label: "Max / Lighten" },
	{ mode: "multiply", label: "Multiply" },
	{ mode: "screen", label: "Screen" },
	{ mode: "overlay", label: "Overlay" },
	{ mode: "soft_light", label: "Soft Light" },
	{ mode: "hard_light", label: "Hard Light" },
	{ mode: "color_dodge", label: "Color Dodge" },
	{ mode: "color_burn", label: "Color Burn" },
	{ mode: "difference", label: "Difference" },
	{ mode: "exclusion", label: "Exclusion" },
	{ mode: "darken", label: "Darken" },
	{ mode: "lighten", label: "Lighten" },
	{ mode: "linear_dodge", label: "Linear Dodge" },
	{ mode: "linear_burn", label: "Linear Burn" },
	{ mode: "vivid_light", label: "Vivid Light" },
	{ mode: "pin_light", label: "Pin Light" },
	{ mode: "hard_mix", label: "Hard Mix" },
	{ mode: "subtract", label: "Subtract" },
	{ mode: "divide", label: "Divide" },
];

function getOverlayBlendMode(): OverlayBlendMode {
	const mode = (localStorage.getItem("mm.visualizer.lastOverlayBlendMode") || window.visualizer?.overlayBlendMode) as OverlayBlendMode;
	return OVERLAY_BLEND_MODE_OPTIONS.some((o) => o.mode === mode) ? mode : "alpha_mix";
}

const SpotifyIcon = React.memo((props: { name: Spicetify.Icon; size?: number }) => (
	<Spicetify.ReactComponent.IconComponent
		semanticColor="textBase"
		dangerouslySetInnerHTML={{ __html: Spicetify.SVGIcons[props.name] }}
		iconSize={props.size ?? 16}
	/>
));

export type VisualizerStudioProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	useSongPalette: boolean;
	onToggleSongPalette: () => void;
	onOpenWindow: () => void;
};

// [[visualizerStudio.panel]]
// @desc - Docked panel with tabs; Esc / close button only (no click-outside dismiss)
// @how - always mounted; data-studio-open on .visualizer-container drives translate via CSS
export default function VisualizerStudio(props: VisualizerStudioProps) {
	const [tab, setTab] = useState<StudioTab>("tune");
	const [showSave, setShowSave] = useState(false);
	const [blendVersion, setBlendVersion] = useState(0);
	const [styleVersion, setStyleVersion] = useState(0);

	useEffect(() => {
		if (!props.open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") props.onOpenChange(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [props.open, props.onOpenChange]);

	const requestSave = useCallback(() => {
		setTab("library");
		setShowSave(true);
	}, []);

	const blendCurrent = useMemo(() => getOverlayBlendMode(), [blendVersion, props.open]);
	const hypnoMode = !!window.visualizer?.hypnoMode;
	const hypnoDirection = window.visualizer?.hypnoDirection === "alternate" ? "alternate" : "normal";

	return (
		<aside
			className={styles.panel}
			aria-label="Visualizer studio"
			aria-hidden={!props.open}
			inert={!props.open ? true : undefined}
		>
			<div className={styles.header}>
				<span className={styles.title}>Studio</span>
				<button
					className={styles.closeBtn}
					aria-label="Close studio"
					onClick={() => props.onOpenChange(false)}
				>
					<SpotifyIcon name="x" />
				</button>
			</div>

			<div className={styles.tabs} role="tablist">
				{(
					[
						["tune", "Tune"],
						["library", "Library"],
						["style", "Style"],
					] as const
				).map(([id, label]) => (
					<button
						key={id}
						role="tab"
						aria-selected={tab === id}
						className={`${styles.tab}${tab === id ? ` ${styles.tabActive}` : ""}`}
						onClick={() => setTab(id)}
					>
						{label}
					</button>
				))}
			</div>

			<div className={styles.body} role="tabpanel">
				{tab === "tune" ? (
					<ControlsInMenu onRequestSave={requestSave} />
				) : null}

				{tab === "library" ? (
					<>
						<div className={styles.rowActions}>
							<StudioCreateNewButton onCreated={() => setShowSave(false)} />
							<button
								className={`${styles.actionBtn} ${styles.actionPrimary}`}
								onClick={() => setShowSave((v) => !v)}
							>
								{showSave ? "Hide save" : "Save…"}
							</button>
						</div>
						{showSave ? (
							<StudioSaveSheet
								onDone={() => setShowSave(false)}
								onCancel={() => setShowSave(false)}
							/>
						) : null}
						<StudioConfigsList />
					</>
				) : null}

				{tab === "style" ? (
					<>
						<div className={styles.sectionLabel}>Hypno</div>
						<div className={styles.card}>
							<div className={styles.segmentGroup}>
								<button
									className={`${styles.segmentBtn}${hypnoMode ? ` ${styles.segmentActive}` : ""}`}
									onClick={() => {
										window.visualizer.hypnoMode = true;
										notifyVisualizerChanged();
										setStyleVersion((x) => x + 1);
									}}
								>
									on
								</button>
								<button
									className={`${styles.segmentBtn}${!hypnoMode ? ` ${styles.segmentActive}` : ""}`}
									onClick={() => {
										window.visualizer.hypnoMode = false;
										notifyVisualizerChanged();
										setStyleVersion((x) => x + 1);
									}}
								>
									off
								</button>
							</div>
							<div className={styles.segmentGroup}>
								<button
									className={`${styles.segmentBtn}${hypnoDirection === "normal" ? ` ${styles.segmentActive}` : ""}`}
									onClick={() => {
										window.visualizer.hypnoDirection = "normal";
										notifyVisualizerChanged();
										setStyleVersion((x) => x + 1);
									}}
								>
									normal
								</button>
								<button
									className={`${styles.segmentBtn}${hypnoDirection === "alternate" ? ` ${styles.segmentActive}` : ""}`}
									onClick={() => {
										window.visualizer.hypnoDirection = "alternate";
										notifyVisualizerChanged();
										setStyleVersion((x) => x + 1);
									}}
								>
									alternate
								</button>
							</div>
						</div>

						<div className={styles.sectionLabel}>Palette</div>
						<div className={styles.card}>
							<button className={styles.actionBtn} onClick={props.onToggleSongPalette}>
								{props.useSongPalette ? "Use Default Palette" : "Use Song Palette"}
							</button>
						</div>

						<div className={styles.sectionLabel}>Overlay blend</div>
						<div className={styles.blendGrid}>
							{OVERLAY_BLEND_MODE_OPTIONS.map(({ mode, label }) => (
								<button
									key={mode}
									className={`${styles.blendChip}${mode === blendCurrent ? ` ${styles.blendActive}` : ""}`}
									onClick={() => {
										window.visualizer.overlayBlendMode = mode;
										window.visualizerLastOverlayBlendMode = mode;
										localStorage.setItem("mm.visualizer.lastOverlayBlendMode", mode);
										notifyVisualizerChanged();
										setBlendVersion((v) => v + 1);
									}}
								>
									{label}
								</button>
							))}
						</div>

						<div className={styles.sectionLabel}>Window</div>
						<div className={styles.card}>
							<button className={styles.actionBtn} onClick={props.onOpenWindow}>
								Open Window
							</button>
						</div>
						{/* @how - styleVersion forces hypno segment re-read after toggle */}
						<span style={{ display: "none" }}>{styleVersion}</span>
					</>
				) : null}
			</div>
		</aside>
	);
}

// [[visualizerStudio.toggle]]
// @what - Floating button that opens/closes the studio dock
export function StudioToggleButton(props: {
	open: boolean;
	onToggle: () => void;
	className?: string;
}) {
	return (
		<button
			type="button"
			className={`${styles.toggleBtn}${props.open ? ` ${styles.toggleOpen}` : ""}${props.className ? ` ${props.className}` : ""}`}
			aria-label={props.open ? "Close studio" : "Open studio"}
			aria-pressed={props.open}
			onClick={props.onToggle}
		>
			<SpotifyIcon name={props.open ? "x" : "edit"} />
		</button>
	);
}

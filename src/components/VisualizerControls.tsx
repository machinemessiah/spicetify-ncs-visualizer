import React, { useMemo, useState } from "react";
import { VISUALIZER_DEFAULTS } from "../config/visualizer.defaults";

type RangeKey = keyof typeof VISUALIZER_DEFAULTS;
type RangeValue = (typeof VISUALIZER_DEFAULTS)[RangeKey];

function isRange(v: unknown): v is { min: number; max: number } {
	return !!v && typeof v === "object" && "min" in (v as any) && "max" in (v as any);
}

// [[visualizer.controls]]
// @what - Simple slider controls for all numeric ranges in `window.visualizer`
// @how - Edits mutate global object directly to take effect immediately
export default function VisualizerControls(props: { onClose: () => void }) {
	const [version, setVersion] = useState(0);

	const entries = useMemo(() => Object.entries(window.visualizer) as [RangeKey, RangeValue][], [version]);

	const getSliderProps = (key: string, v: { min: number; max: number }) => {
		if (key === "dotCount") {
			return { min: 4, max: 2048, step: 1 } as const;
		}
		const lo = Math.min(v.min, v.max);
		const hi = Math.max(v.min, v.max);
		const span = Math.max(1e-3, hi - lo);
		const extra = span;
		return { min: lo - extra, max: hi + extra, step: 0.001 } as const;
	};

	const resetToDefaults = () => {
		Object.entries(VISUALIZER_DEFAULTS).forEach(([k, v]) => {
			if (isRange(v)) {
				(window.visualizer as any)[k] = { ...v };
			} else {
				(window.visualizer as any)[k] = v as any;
			}
		});
		setVersion(x => x + 1);
	};

	const SliderRow = ({
		label,
		value,
		onChange,
		min,
		max,
		step
	}: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number }) => {
		const handleDrag = (drag: number) => {
			// @? - Spicetify slider callbacks sometimes provide percent
			const normalized = drag >= 0 && drag <= 1 ? min + drag * (max - min) : drag;
			const clamped = Math.max(min, Math.min(max, normalized));
			onChange(clamped);
		};

		return (
			<div style={{ display: "grid", gridTemplateColumns: "90px 1fr 72px", alignItems: "center", gap: 8 }}>
				<Spicetify.ReactComponent.TextComponent semanticColor="textSubdued">{label}</Spicetify.ReactComponent.TextComponent>
				<Spicetify.ReactComponent.Slider
					value={value}
					min={min}
					max={max}
					step={step}
					isInteractive
					onDragStart={handleDrag}
					onDragMove={handleDrag}
					onDragEnd={handleDrag}
				/>
				<Spicetify.ReactComponent.TextComponent variant="viola" semanticColor="textSubdued">
					{value.toFixed(step >= 1 ? 0 : 3)}
				</Spicetify.ReactComponent.TextComponent>
			</div>
		);
	};

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 8, width: 560 }}>
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
				<Spicetify.ReactComponent.TextComponent variant="balladBold">Visualizer Controls</Spicetify.ReactComponent.TextComponent>
				<div style={{ display: "flex", gap: 8 }}>
					<Spicetify.ReactComponent.ButtonTertiary onClick={resetToDefaults}>Reset</Spicetify.ReactComponent.ButtonTertiary>
					<Spicetify.ReactComponent.ButtonSecondary onClick={props.onClose}>Close</Spicetify.ReactComponent.ButtonSecondary>
				</div>
			</div>

			{entries.map(([key, value]) => {
				if (!isRange(value)) return null;
				const pretty = key.replace(/([a-z])([A-Z])/g, "$1 $2");
				const { min: sliderMin, max: sliderMax, step } = getSliderProps(key, value);

				return (
					<div key={key} style={{ padding: 12, borderRadius: 8, background: "var(--spice-card)", display: "grid", gap: 8 }}>
						<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
							<Spicetify.ReactComponent.TextComponent>{pretty}</Spicetify.ReactComponent.TextComponent>
							<Spicetify.ReactComponent.TextComponent variant="viola" semanticColor="textSubdued">
								{value.min.toFixed(step >= 1 ? 0 : 3)} → {value.max.toFixed(step >= 1 ? 0 : 3)}
							</Spicetify.ReactComponent.TextComponent>
						</div>
						<SliderRow
							label="min"
							value={value.min}
							min={sliderMin}
							max={sliderMax}
							step={step}
							onChange={(v) => {
								(window.visualizer as any)[key] = { ...value, min: v };
								setVersion(x => x + 1);
							}}
						/>
						<SliderRow
							label="max"
							value={value.max}
							min={sliderMin}
							max={sliderMax}
							step={step}
							onChange={(v) => {
								(window.visualizer as any)[key] = { ...value, max: v };
								setVersion(x => x + 1);
							}}
						/>
					</div>
				);
			})}
		</div>
	);
}

// [[visualizer.controls.open]]
// @what - Helper to open controls overlay
export function openVisualizerControls() {
	// [[visualizer.controls.modal]]
	// @how - Render content into an element and hand it to Spicetify's PopupModal
	const host = document.createElement("div");
	const close = () => {
		Spicetify.PopupModal.hide();
		try {
			Spicetify.ReactDOM.unmountComponentAtNode(host);
		} catch { }
	};

	Spicetify.ReactDOM.render(<VisualizerControls onClose={close} />, host);
	Spicetify.PopupModal.display({ title: "Visualizer Controls", content: host, isLarge: true });
}



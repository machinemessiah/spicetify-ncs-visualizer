import React, { useMemo, useState } from "react";
import { VISUALIZER_DEFAULTS } from "../config/visualizer.defaults";
import styles from "../css/controls.module.scss";

type RangeKey = keyof typeof VISUALIZER_DEFAULTS;
type RangeValue = (typeof VISUALIZER_DEFAULTS)[RangeKey];

function isRange(v: unknown): v is { min: number; max: number } {
	return !!v && typeof v === "object" && "min" in (v as any) && "max" in (v as any);
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
		if (value <= 16) return 2;
		if (value <= 64) return 16;
		if (value <= 128) return 32;
		if (value <= 256) return 64;
		if (value >= 512) return 128;
		return 16;
	}
	if (key === "motionBlur") return 0.01;
	return 0.1;
}

function fmt(key: string, v: number): string {
	if (key === "dotCount") return String(Math.round(v));
	if (key === "motionBlur") return v.toFixed(2);
	return v.toFixed(1);
}

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
				className={styles.valueInput || styles.value}
				autoFocus
				value={tempVal}
				onChange={(e) => {
					const v = e.target.value;
					const regex = keyName === "dotCount" ? /^-?\d*$/ : /^-?\d*\.?\d*$/;
					if (v === "" || regex.test(v)) {
						setTempVal(v);
					}
				}}
				onBlur={handleCommit}
				onKeyDown={(e) => {
					if (e.key === "Enter") handleCommit();
					if (e.key === "Escape") {
						setIsEditing(false);
						setTempVal(fmt(keyName, value));
					}
				}}
				style={{ width: "40px", textAlign: "center", background: "transparent", color: "inherit", border: "none", outline: "none", borderBottom: "1px solid var(--spice-text)" }}
			/>
		);
	}

	return (
		<span
			className={styles.value}
			onClick={(e) => {
				e.stopPropagation();
				setIsEditing(true);
				setTempVal(fmt(keyName, value));
			}}
			style={{ cursor: "text" }}
		>
			{fmt(keyName, value)}
		</span>
	);
}

// [[menu.controls.inline]]
// @what - Inline controls rendered inside Spicetify menu; uses simple buttons to increment ranges
export default function ControlsInMenu() {
	const [version, setVersion] = useState(0);
	const keys = useMemo(() => Object.keys(VISUALIZER_DEFAULTS) as RangeKey[], [version]);

	const setExactValue = (key: string, which: "min" | "max" | "value", newValue: number) => {
		const cur = (window.visualizer as any)[key];
		
		if (key === "motionBlur") {
			let val = newValue;
			val = Math.max(0, Math.min(0.99, val));
			(window.visualizer as any)[key] = val;
			setVersion(x => x + 1);
			return;
		}
		
		if (!isRange(cur)) return;
		
		const next = { ...cur, [which]: newValue } as { min: number; max: number };
		if (key === "dotCount") {
			next.min = Math.round(next.min);
			next.max = Math.round(next.max);
		}
		(window.visualizer as any)[key] = next;
		setVersion(x => x + 1);
	};

	const adjust = (key: string, which: "min" | "max" | "value", delta: number) => {
		const cur = (window.visualizer as any)[key];
		
		if (key === "motionBlur") {
			let val = VISUALIZER_DEFAULTS.motionBlur;
			if (typeof cur === "number") val = cur;
			else if (cur && typeof cur.max === "number") val = cur.max;
			
			const s = stepFor(key, val);
			let nextVal = val + delta * s;
			nextVal = Math.max(0, Math.min(0.99, nextVal));
			
			(window.visualizer as any)[key] = nextVal;
			setVersion(x => x + 1);
			return;
		}
		
		if (!isRange(cur)) return;
		const s = stepFor(key, cur[which]);
		let nextVal = cur[which] + delta * s;
		
		const next = { ...cur, [which]: nextVal } as { min: number; max: number };
		// @how - keep integer for dotCount
		if (key === "dotCount") {
			next.min = Math.round(next.min);
			next.max = Math.round(next.max);
		}
		(window.visualizer as any)[key] = next;
		setVersion(x => x + 1);
	};

	return (
		<div className={styles.controls}>
			{keys.map(key => {
				const rawValue = (window.visualizer as any)[key];
				const pretty = key.replace(/([a-z])([A-Z])/g, "$1 $2");
				
				if (key === "motionBlur") {
					let val = VISUALIZER_DEFAULTS.motionBlur;
					if (typeof rawValue === "number") val = rawValue;
					else if (rawValue && typeof rawValue.max === "number") val = rawValue.max;
					
					return (
						<div key={key} className={styles.card}>
							<div className={styles.rowHeader}>
								<Spicetify.ReactComponent.TextComponent className={styles.rowTitle}>{pretty}</Spicetify.ReactComponent.TextComponent>
								<span className={styles.valuePill}>{fmt(key, val)}</span>
							</div>
							<div className={styles.line}>
								<span className={styles.label}>value</span>
								<div className={styles.stepper}>
									<button className={styles.button}
										onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, "value", -10); }}
										aria-label={`greatly decrease ${pretty}`}
									>
										<span className={styles.icon}><Icon name="block" /></span>
									</button>
									<button className={styles.button}
										onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, "value", -1); }}
										aria-label={`decrease ${pretty}`}
									>
										<span className={styles.icon}><Icon name="minus" /></span>
									</button>
									<EditableValue value={val} keyName={key} onCommit={(v) => setExactValue(key, "value", v)} />
									<button className={styles.button}
										onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, "value", +1); }}
										aria-label={`increase ${pretty}`}
									>
										<span className={styles.icon}><Icon name="plus2px" /></span>
									</button>
									<button className={styles.button}
										onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, "value", +10); }}
										aria-label={`greatly increase ${pretty}`}
									>
										<span className={styles.icon}><Icon name="plus-alt" /></span>
									</button>
								</div>
							</div>
						</div>
					);
				}
				
				// @what - For all other properties, we expect a range object
				// @why - If it's missing from localStorage or not a range, fallback to default
				let value = rawValue;
				if (!isRange(value)) {
					value = VISUALIZER_DEFAULTS[key];
					if (!isRange(value)) return null; // Should not happen for other defaults
				}
				
				return (
					<div key={key} className={styles.card}>
						<div className={styles.rowHeader}>
							<Spicetify.ReactComponent.TextComponent className={styles.rowTitle}>{pretty}</Spicetify.ReactComponent.TextComponent>
							<span className={styles.valuePill}>{fmt(key, value.min)} → {fmt(key, value.max)}</span>
						</div>
						<div className={styles.line}>
							<span className={styles.label}>min</span>
							<div className={styles.stepper}>
								<button className={styles.button}
									onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, "min", -10); }}
									aria-label={`greatly decrease ${pretty} min`}
								>
									<span className={styles.icon}><Icon name="block" /></span>
								</button>
								<button className={styles.button}
									onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, "min", -1); }}
									aria-label={`decrease ${pretty} min`}
								>
									<span className={styles.icon}><Icon name="minus" /></span>
								</button>
								<EditableValue value={value.min} keyName={key} onCommit={(v) => setExactValue(key, "min", v)} />
								<button className={styles.button}
									onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, "min", +1); }}
									aria-label={`increase ${pretty} min`}
								>
									<span className={styles.icon}><Icon name="plus2px" /></span>
								</button>
								<button className={styles.button}
									onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, "min", +10); }}
									aria-label={`greatly increase ${pretty} min`}
								>
									<span className={styles.icon}><Icon name="plus-alt" /></span>
								</button>
							</div>
						</div>
						<div className={styles.line}>
							<span className={styles.label}>max</span>
							<div className={styles.stepper}>
								<button className={styles.button}
									onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, "max", -10); }}
									aria-label={`greatly decrease ${pretty} max`}
								>
									<span className={styles.icon}><Icon name="block" /></span>
								</button>
								<button className={styles.button}
									onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, "max", -1); }}
									aria-label={`decrease ${pretty} max`}
								>
									<span className={styles.icon}><Icon name="minus" /></span>
								</button>
								<EditableValue value={value.max} keyName={key} onCommit={(v) => setExactValue(key, "max", v)} />
								<button className={styles.button}
									onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, "max", +1); }}
									aria-label={`increase ${pretty} max`}
								>
									<span className={styles.icon}><Icon name="plus2px" /></span>
								</button>
								<button className={styles.button}
									onClick={(e) => { e.stopPropagation(); e.preventDefault(); adjust(key, "max", +10); }}
									aria-label={`greatly increase ${pretty} max`}
								>
									<span className={styles.icon}><Icon name="plus-alt" /></span>
								</button>
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
}



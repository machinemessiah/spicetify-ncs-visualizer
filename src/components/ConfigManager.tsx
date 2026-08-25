// [[components.configManager]]
// [[@config.configStore]]
// [[@components.visualizerStudio]]
// @when - 07-27-2026
// @what - Named-config library + inline save sheet for the Studio panel
// @desc - Plain DOM controls (no Spicetify MenuItem / PopupModal). Persistence still via configStore.

import React, { useState } from "react";
import { VISUALIZER_DEFAULTS } from "../config/visualizer.defaults";
import {
	getConfigs,
	getCurrentName,
	isDirty,
	isValidName,
	nameInUse,
	defaultName,
	snapshotValues,
	saveNewConfig,
	overwriteConfig,
	applyLiveValues,
} from "../config/configStore";
import styles from "../css/studio.module.scss";

// @@ notify
function notify(msg: string) {
	((Spicetify as any)?.showMotification?.(msg, "success")) ?? (Spicetify?.showNotification(msg));
}

// [[configManager.nameValidation]]
// @@ validateName
export function validateName(name: string, allowExisting: string | null): string | null {
	if (!name.trim()) return "Name cannot be empty";
	if (!isValidName(name)) return "Only letters, numbers, spaces, and . : _ - are allowed";
	if (name !== allowExisting && nameInUse(name)) return `"${name}" is already in use`;
	return null;
}

// [[configManager.studioSaveSheet]]
// @purpose - Inline overwrite / save-as form inside Library tab
export function StudioSaveSheet(props: { onDone: () => void; onCancel: () => void }) {
	const loadedName = getCurrentName();
	const canOverwrite = loadedName !== null;
	const [mode, setMode] = useState<"overwrite" | "new">(canOverwrite ? "overwrite" : "new");
	const [name, setName] = useState(canOverwrite ? loadedName! : defaultName());

	const error = validateName(name, mode === "overwrite" ? loadedName : null);

	const pickMode = (m: "overwrite" | "new") => {
		setMode(m);
		setName(m === "overwrite" && loadedName ? loadedName : defaultName());
	};

	const confirm = () => {
		if (error) return;
		if (getCurrentName() !== null && !isDirty() && mode === "overwrite") {
			notify("No changes to save");
			props.onDone();
			return;
		}
		const values = snapshotValues();
		if (mode === "overwrite" && loadedName !== null) {
			overwriteConfig(loadedName, name.trim(), values);
		} else {
			saveNewConfig(name.trim(), values);
		}
		console.gold(`[NCSVisualizer] Saved config "${name.trim()}"`, window.visualizer);
		notify(`Config "${name.trim()}" saved`);
		props.onDone();
	};

	return (
		<div className={styles.saveSheet}>
			{canOverwrite ? (
				<div className={styles.modeRow}>
					<button
						className={`${styles.modeBtn}${mode === "overwrite" ? ` ${styles.modeActive}` : ""}`}
						onClick={() => pickMode("overwrite")}
					>
						Overwrite
					</button>
					<button
						className={`${styles.modeBtn}${mode === "new" ? ` ${styles.modeActive}` : ""}`}
						onClick={() => pickMode("new")}
					>
						Save as new
					</button>
				</div>
			) : null}
			<input
				className={styles.search}
				autoFocus
				value={name}
				spellCheck={false}
				onChange={(e) => setName(e.target.value)}
				onFocus={(e) => e.target.select()}
				onKeyDown={(e) => {
					if (e.key === "Enter") confirm();
					if (e.key === "Escape") props.onCancel();
				}}
				placeholder="Config name"
			/>
			{error ? <div className={styles.error}>{error}</div> : null}
			<div className={styles.rowActions}>
				<button className={styles.actionBtn} onClick={props.onCancel}>Cancel</button>
				<button className={`${styles.actionBtn} ${styles.actionPrimary}`} disabled={!!error} onClick={confirm}>
					{mode === "overwrite" ? "Overwrite" : "Save"}
				</button>
			</div>
		</div>
	);
}

// [[configManager.studioConfigsList]]
// @how - Filterable plain list; load applies currentConfig via applyLiveValues
export function StudioConfigsList() {
	const [version, setVersion] = useState(0);
	const [query, setQuery] = useState("");
	const configs = getConfigs();
	const names = Object.keys(configs).reverse();
	const loadedName = getCurrentName();
	const filtered = names.filter((n) => n.toLowerCase().includes(query.trim().toLowerCase()));

	const loadConfig = (name: string) => {
		applyLiveValues(configs[name], name);
		notify(`Loaded config "${name}"`);
		setVersion((x) => x + 1);
	};

	return (
		<>
			<input
				className={styles.search}
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder="Search configs…"
				spellCheck={false}
			/>
			<div className={styles.configList} data-version={version}>
				{filtered.length === 0 ? (
					<div className={styles.emptyHint}>No configs match.</div>
				) : (
					filtered.map((name) => (
						<button
							key={name}
							type="button"
							className={`${styles.configRow}${name === loadedName ? ` ${styles.configActive}` : ""}`}
							onClick={() => loadConfig(name)}
						>
							{name}
						</button>
					))
				)}
			</div>
		</>
	);
}

// [[configManager.studioCreateNew]]
export function StudioCreateNewButton(props: { onCreated?: () => void }) {
	return (
		<button
			type="button"
			className={styles.actionBtn}
			onClick={() => {
				const fresh = JSON.parse(JSON.stringify(VISUALIZER_DEFAULTS));
				fresh.createdAt = new Date().toISOString();
				applyLiveValues(fresh, null);
				notify("New config (defaults loaded)");
				props.onCreated?.();
			}}
		>
			+ New config
		</button>
	);
}

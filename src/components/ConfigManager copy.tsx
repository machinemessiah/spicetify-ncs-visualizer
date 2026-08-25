// [[components.configManager]]
// [[@config.configStore]]
// [[@menu.main]]
// @when - 06-12-2026
// @what - UI pieces for the named-config workflow: save dialog, configs dropdown list, and the
//         editable "current config name" menu item
// @desc - All persistence goes through configStore.ts; these components never touch localStorage
//         directly. `window.visualizer` is only mutated when LOADING a config or resetting to defaults.

import React, { useState } from "react";
import { VISUALIZER_DEFAULTS } from "../config/visualizer.defaults";
import {
	getConfigs,
	getCurrentName,
	setCurrent,
	isDirty,
	isValidName,
	nameInUse,
	defaultName,
	snapshotValues,
	saveNewConfig,
	overwriteConfig
} from "../config/configStore";
import styles from "../css/controls.module.scss";

// @@ notify
// @desc - Toast helper; prefers the custom styled notifier when available
// @param - msg {String}
function notify(msg: string) {
	((Spicetify as any)?.showMotification?.(msg, "success")) ?? (Spicetify?.showNotification(msg));
}

// @@ closeModal
// @how - Hide the PopupModal and unmount our rendered host to avoid leaking React roots
function closeModal(host: HTMLElement) {
	Spicetify.PopupModal.hide();
	try {
		Spicetify.ReactDOM.unmountComponentAtNode(host);
	} catch { }
}

// [[configManager.nameValidation]]
// @@ validateName
// @desc - Shared validation used by the save dialog and the rename item
// @param - name {String} candidate name
// @param - allowExisting {String|null} a name that is allowed to "collide" (the config being overwritten)
// @return - {String|null} human-readable error, or null when valid
function validateName(name: string, allowExisting: string | null): string | null {
	if (!name.trim()) return "Name cannot be empty";
	if (!isValidName(name)) return "Only letters, numbers, spaces, and . : _ - are allowed";
	if (name !== allowExisting && nameInUse(name)) return `"${name}" is already in use`;
	return null;
}

// [[configManager.saveDialog]]
// @what - Modal asking the user to overwrite the loaded config or save as a new one, plus a name input
// @how - mode toggle repopulates the name field (existing name vs timestamp) so the user can just hit Enter
function SaveConfigDialog(props: { loadedName: string | null; onDone: () => void }) {
	const canOverwrite = props.loadedName !== null;
	const [mode, setMode] = useState<"overwrite" | "new">(canOverwrite ? "overwrite" : "new");
	const [name, setName] = useState(canOverwrite ? props.loadedName! : defaultName());

	// @? - in overwrite mode the original name is allowed to collide with itself
	const error = validateName(name, mode === "overwrite" ? props.loadedName : null);

	const pickMode = (m: "overwrite" | "new") => {
		setMode(m);
		// @how - pre-populate per spec: existing name when overwriting, timestamp when saving new
		setName(m === "overwrite" ? props.loadedName! : defaultName());
	};

	const confirm = () => {
		if (error) return;
		const values = snapshotValues();
		if (mode === "overwrite" && props.loadedName !== null) {
			// @how - values + name replaced in place; position in the CONFIGS object is preserved
			overwriteConfig(props.loadedName, name.trim(), values);
		} else {
			saveNewConfig(name.trim(), values);
		}
		console.gold(`[NCSVisualizer] Saved config "${name.trim()}"`, window.visualizer);
		notify(`Config "${name.trim()}" saved`);
		props.onDone();
	};

	return (
		<div className={styles.dialog}>
			{canOverwrite && (
				<div className={styles.dialogModes}>
					{/* @what - mode toggle: overwrite the loaded config vs append a new one */}
					<button
						className={`${styles.modeButton} ${mode === "overwrite" ? styles.modeActive : ""}`}
						onClick={() => pickMode("overwrite")}
					>
						Overwrite "{props.loadedName}"
					</button>
					<button
						className={`${styles.modeButton} ${mode === "new" ? styles.modeActive : ""}`}
						onClick={() => pickMode("new")}
					>
						Save as new
					</button>
				</div>
			)}
			<input
				className={styles.dialogInput}
				autoFocus
				value={name}
				spellCheck={false}
				onChange={(e) => setName(e.target.value)}
				onFocus={(e) => e.target.select()}
				onKeyDown={(e) => {
					if (e.key === "Enter") confirm();
					if (e.key === "Escape") props.onDone();
				}}
			/>
			{error && <div className={styles.dialogError}>{error}</div>}
			<div className={styles.dialogActions}>
				<button className={styles.resetBtn} onClick={() => props.onDone()}>Cancel</button>
				<button className={styles.resetBtn} disabled={!!error} onClick={confirm}>
					{mode === "overwrite" ? "Overwrite" : "Save"}
				</button>
			</div>
		</div>
	);
}

// [[configManager.openSaveDialog]]
// [[@menu.save.config]]
// @@ openSaveConfigDialog
// @desc - Entry point for the SAVE CURRENT CONFIG menu item
// @why - `window.prompt` is unreliable in the Spotify CEF client, so we use PopupModal instead
export function openSaveConfigDialog() {
	// @what - nothing changed since load/save -> nothing to do
	if (getCurrentName() !== null && !isDirty()) {
		notify("No changes to save");
		return;
	}
	const host = document.createElement("div");
	Spicetify.ReactDOM.render(
		<SaveConfigDialog loadedName={getCurrentName()} onDone={() => closeModal(host)} />,
		host
	);
	Spicetify.PopupModal.display({ title: "Save Visualizer Config", content: host });
}

// [[configManager.confirmDialog]]
// @@ openConfirmDialog
// @desc - Tiny yes/no modal (used by rename, since window.confirm is equally unreliable)
// @param - message {String}
// @param - onConfirm {Function}
function openConfirmDialog(message: string, onConfirm: () => void) {
	const host = document.createElement("div");
	const done = () => closeModal(host);
	Spicetify.ReactDOM.render(
		<div className={styles.dialog}>
			<div>{message}</div>
			<div className={styles.dialogActions}>
				<button className={styles.resetBtn} onClick={done}>Cancel</button>
				<button className={styles.resetBtn} onClick={() => { done(); onConfirm(); }}>Overwrite</button>
			</div>
		</div>,
		host
	);
	Spicetify.PopupModal.display({ title: "Confirm", content: host });
}

// [[configManager.currentNameItem]]
// @what - Menu item displaying the loaded config's name; click-to-edit renames (and overwrites) it
// @how - Same edit-on-click pattern as EditableValue in ControlsInMenu.tsx
// @also - When no config is loaded ("unsaved"), clicking opens the save dialog instead, since there
//         is nothing to rename yet
export function CurrentConfigNameItem() {
	const [isEditing, setIsEditing] = useState(false);
	const [tempName, setTempName] = useState("");
	const loadedName = getCurrentName();

	const commit = () => {
		setIsEditing(false);
		const next = tempName.trim();
		if (loadedName === null || next === loadedName) return;
		if (validateName(next, null) !== null) {
			notify(validateName(next, null)!);
			return;
		}
		// @why - renaming immediately overwrites the stored config (values + name), so confirm first
		openConfirmDialog(`Overwrite config "${loadedName}" as "${next}"?`, () => {
			overwriteConfig(loadedName, next, snapshotValues());
			console.gold(`[NCSVisualizer] Renamed config "${loadedName}" -> "${next}"`, window.visualizer);
			notify(`Config renamed to "${next}"`);
		});
	};

	if (isEditing && loadedName !== null) {
		return (
			<div className={styles.currentName}>
				<input
					className={styles.dialogInput}
					autoFocus
					value={tempName}
					spellCheck={false}
					onChange={(e) => setTempName(e.target.value)}
					onClick={(e) => e.stopPropagation()}
					onBlur={commit}
					onKeyDown={(e) => {
						if (e.key === "Enter") commit();
						if (e.key === "Escape") setIsEditing(false);
					}}
				/>
			</div>
		);
	}

	return (
		<Spicetify.ReactComponent.MenuItem disabled={true} onClick={(e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (loadedName === null) {
				openSaveConfigDialog();
				return;
			}
			setTempName(loadedName);
			setIsEditing(true);
		}}>
			<span className={loadedName === null ? styles.unsavedName : undefined}>
				{loadedName === null ? "[ unsaved config ]" : `⚙ ${loadedName}`}
			</span>
		</Spicetify.ReactComponent.MenuItem>
	);
}

// [[configManager.configsList]]
// @what - Scrollable list of saved configs (newest first) with a "Create a New CONFIG" entry on top
// @how - Selecting an entry only mutates `window.visualizer` in memory; NOTHING is written to
//        localStorage until the user explicitly saves
export function ConfigsList() {
	// @? - cheap re-render hook so the highlight follows the loaded config without remounting the menu
	const [, setVersion] = useState(0);
	const configs = getConfigs();
	// @how - reversed so the latest saved config appears at the top
	const names = Object.keys(configs).reverse();
	const loadedName = getCurrentName();

	const loadConfig = (name: string) => {
		// @how - deep clone so live tweaks never mutate the stored snapshot
		window.visualizer = JSON.parse(JSON.stringify(configs[name]));
		setCurrent(name, configs[name]);
		notify(`Loaded config "${name}"`);
		setVersion(x => x + 1);
	};

	return (
		<div className="config-manager-list">
			<Spicetify.ReactComponent.MenuItem disabled={true} onClick={() => {
				// @what - "new config" = defaults, no name, nothing persisted
				window.visualizer = JSON.parse(JSON.stringify(VISUALIZER_DEFAULTS));
				setCurrent(null);
				notify("New config (defaults loaded)");
				setVersion(x => x + 1);
			}}>
				✚ Create a New CONFIG
			</Spicetify.ReactComponent.MenuItem>
			<div className={styles.configList}>
				{names.map(name => (
					<Spicetify.ReactComponent.MenuItem disabled={true} key={name} onClick={() => loadConfig(name)}>
						<span className={name === loadedName ? styles.loadedConfig : undefined}>{name}</span>
					</Spicetify.ReactComponent.MenuItem>
				))}
			</div>
		</div>
	);
}

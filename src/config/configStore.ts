// [[config.configStore]]
// [[@config.visualizer.defaults]]
// [[@ncs.visualizer.defaults.init]]
// [[@menu.save.config]]
// @when - 06-12-2026
// @what - Shared store for named visualizer configs + live currentConfig session
// @desc - Owns CONFIGS CRUD, one-time migrations, currentConfig persistence, and
//         baseline-aware per-field dirty/revert helpers used by the controls UI.
// @!note - Named CONFIGS are still saved only via explicit user action; the live
//          `mm.visualizer.currentConfig` IS written after every live tweak.

import { VISUALIZER_DEFAULTS, type HypnoDirection } from "./visualizer.defaults";

// @what - The persisted shape: name -> config snapshot
export type VisualizerConfigValues = typeof VISUALIZER_DEFAULTS;
export type ConfigMap = Record<string, VisualizerConfigValues>;
export type ConfigFieldKey = keyof VisualizerConfigValues;
// @what - nested numeric parts on range-like objects (min/max + optional dotRadius multipliers)
export type RangePart = "min" | "max" | "multiplierLow" | "multiplierHigh";

// [[config.configStore.currentConfig]]
// @purpose - Temporary live session that survives Spotify reloads
export type VisualizerCurrentConfig = {
	basedOn: string | null;
	values: VisualizerConfigValues;
};

// @value - localStorage key holding the named configs object
const STORAGE_KEY = "mm.visualizer.CONFIGS";
// @value - live session blob (basedOn + values)
const CURRENT_CONFIG_KEY = "mm.visualizer.currentConfig";
// @value - one-time hypno migration flag
const HYPNO_MIGRATION_FLAG = "mm.visualizer.migrated.hypno.07-26-2026";
// @value - backup key for pre-migration CONFIGS snapshot
const HYPNO_BACKUP_KEY = "mm.visualizer.CONFIG.07-26-2026";
// @values - refresh-rate tokens scanned in config names (higher first)
const RATE_TOKENS = [360, 240, 165, 144] as const;
// @values - keys skipped when counting dirty fields / restore-all UI
const META_KEYS = new Set<ConfigFieldKey>(["createdAt"]);

// [[config.configStore.currentName]]
// @what - In-memory tracking of which named config is "loaded" for save/overwrite UX
// @values - currentName: name of the loaded config (null = unsaved "new" config)
//           pristineSnapshot: JSON of baseline values for whole-object isDirty()
let currentName: string | null = null;
let pristineSnapshot: string | null = null;

function deepClone<T>(v: T): T {
	return JSON.parse(JSON.stringify(v));
}

function isRange(v: unknown): v is { min: number; max: number } {
	return !!v && typeof v === "object" && "min" in (v as object) && "max" in (v as object);
}

// @@ getConfigs
// @desc - Read + parse the stored configs, migrating from the legacy array format if needed
// @return - {Object} ConfigMap (name -> config)
export function getConfigs(): ConfigMap {
	let parsed: unknown;
	try {
		parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
	} catch {
		parsed = {};
	}

	// [[config.configStore.migration]]
	// @what - One-time migration: legacy array -> object keyed by original array index
	// @how - Index becomes the name ("0", "1", ...); written back immediately so all later reads see the new shape
	// @but - JS orders integer-like keys numerically before insertion-ordered string keys, so renaming a
	//        migrated "0"/"1"/... entry to a text name can shift its display position. Harmless, just cosmetic.
	if (Array.isArray(parsed)) {
		const migrated: ConfigMap = {};
		parsed.forEach((cfg, i) => { migrated[String(i)] = cfg; });
		localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
		return migrated;
	}

	return (parsed && typeof parsed === "object") ? parsed as ConfigMap : {};
}

// @@ writeConfigs
// @param - configs {Object} full ConfigMap to persist
function writeConfigs(configs: ConfigMap) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

// [[config.configStore.hypnoMigration]]
// @@ inferHypnoFromName
// @desc - Derive hypnoMode + hypnoModeRefreshRate from a config name for the one-time backfill
// @param - name {String} CONFIGS key
// @return - { hypnoMode, hypnoModeRefreshRate, hypnoDirection }
function inferHypnoFromName(name: string): {
	hypnoMode: boolean;
	hypnoModeRefreshRate: number;
	hypnoDirection: HypnoDirection;
} {
	const lower = name.toLowerCase();
	let hypnoModeRefreshRate = 144;
	for (const rate of RATE_TOKENS) {
		if (lower.includes(String(rate))) {
			hypnoModeRefreshRate = rate;
			break;
		}
	}

	// @necessary - "nohypno" always wins; otherwise hypno token OR a rate token enables hypno
	let hypnoMode = false;
	if (lower.includes("nohypno")) {
		hypnoMode = false;
	} else if (lower.includes("hypno") || RATE_TOKENS.some((r) => lower.includes(String(r)))) {
		hypnoMode = true;
	}

	return { hypnoMode, hypnoModeRefreshRate, hypnoDirection: "normal" };
}

// @@ migrateHypnoIntoConfigs
// @when - 07-26-2026
// @purpose - One-time: backup CONFIGS, then stamp hypno fields inferred from each name
// @how - Gated by HYPNO_MIGRATION_FLAG so it never re-runs
export function migrateHypnoIntoConfigs(): void {
	if (localStorage.getItem(HYPNO_MIGRATION_FLAG) === "1") return;

	const raw = localStorage.getItem(STORAGE_KEY) ?? "{}";
	// @important - backup BEFORE mutating so we can recover if inference is wrong
	localStorage.setItem(HYPNO_BACKUP_KEY, raw);

	const configs = getConfigs();
	const next: ConfigMap = {};
	for (const [name, cfg] of Object.entries(configs)) {
		const inferred = inferHypnoFromName(name);
		next[name] = {
			...deepClone({ ...VISUALIZER_DEFAULTS, ...cfg }),
			hypnoMode: inferred.hypnoMode,
			hypnoDirection: inferred.hypnoDirection,
			hypnoModeRefreshRate: inferred.hypnoModeRefreshRate,
		};
	}
	writeConfigs(next);
	localStorage.setItem(HYPNO_MIGRATION_FLAG, "1");
}

// @@ isValidName
// @desc - Names must only contain chars that are JSON-stringify/parse safe and readable
// @how - Letters, digits, underscore, space, dot, colon, dash; covers the default timestamp format
// @return - {Boolean}
export function isValidName(name: string): boolean {
	return /^[\w .:\-]+$/.test(name);
}

// @@ nameInUse
// @return - {Boolean} true if a config with this name already exists
export function nameInUse(name: string): boolean {
	return Object.prototype.hasOwnProperty.call(getConfigs(), name);
}

// @@ defaultName
// @desc - Generates the default pre-populated name for new configs
// @return - {String} current date/time as "MM-DD-YYYY THH:mm:ss"
export function defaultName(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${p(d.getMonth() + 1)}-${p(d.getDate())}-${d.getFullYear()} T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// @@ snapshotValues
// @desc - Deep-clone the live `window.visualizer` so stored configs can't be mutated by live tweaking
// @return - {Object} plain JSON clone
export function snapshotValues(): VisualizerConfigValues {
	return deepClone(window.visualizer);
}

// [[config.configStore.hypnoSync]]
// @@ directionToBoolean
// @= - "normal" => true, "alternate" => false (matches legacy window.visualizerHypnoDirection)
export function directionToBoolean(dir: HypnoDirection | undefined): boolean {
	return dir !== "alternate";
}

// @@ booleanToDirection
export function booleanToDirection(normal: boolean): HypnoDirection {
	return normal ? "normal" : "alternate";
}

// @@ syncHypnoGlobalsFromVisualizer
// @how - Push config hypno fields onto legacy window globals + CSS refresh-rate vars
// @also - Mirrors into the old localStorage keys so other code paths stay coherent
export function syncHypnoGlobalsFromVisualizer(values: VisualizerConfigValues = window.visualizer): void {
	const mode = !!values.hypnoMode;
	const dirBool = directionToBoolean(values.hypnoDirection);
	const rate = Number.isFinite(Number(values.hypnoModeRefreshRate))
		? Number(values.hypnoModeRefreshRate)
		: VISUALIZER_DEFAULTS.hypnoModeRefreshRate;

	window.visualizerHypnoMode = mode;
	window.visualizerHypnoDirection = dirBool;
	localStorage.setItem("mm.visualizer.hypnoMode", mode ? "true" : "false");
	localStorage.setItem("mm.visualizer.hypnoDirection", dirBool ? "true" : "false");

	if (window.mm?.refreshRate) {
		window.mm.refreshRate.ms = 1000 / rate;
		window.mm.refreshRate.rawMS = rate;
		window.mm.refreshRate.directionAsBoolean = dirBool;
		window.mm.refreshRate.direction = dirBool ? "normal" : "alternate";
	}
	window.Utilities?.addCSSRule?.(
		"mm-refresh-rate",
		`:root { --mm-refresh-rate-ms: ${1000 / rate}ms; --mm-refresh-rate-raw-ms: ${rate}ms; --mm-refresh-rate-direction: ${dirBool ? "normal" : "alternate"}; --mm-refresh-rate-direction-as-boolean: ${dirBool ? "1" : "0"}; }`,
		true
	);

	const canvas = document.querySelector(".visualizer-canvas");
	const button = document.querySelector(".hypno-mode-button");
	if (canvas) {
		canvas.classList.toggle("HYPNOTOAD", mode);
	}
	if (button) {
		button.classList.toggle("HYPNOTOAD", mode);
	}
}

// @@ normalizeVisualizerValues
// @desc - Fill missing newer fields from defaults so old snapshots remain usable
export function normalizeVisualizerValues(raw: Partial<VisualizerConfigValues> | null | undefined): VisualizerConfigValues {
	const base = deepClone(VISUALIZER_DEFAULTS);
	if (!raw || typeof raw !== "object") return base;
	const merged = { ...base, ...deepClone(raw) } as VisualizerConfigValues;
	if (typeof merged.hypnoMode !== "boolean") merged.hypnoMode = !!merged.hypnoMode;
	if (merged.hypnoDirection !== "normal" && merged.hypnoDirection !== "alternate") {
		merged.hypnoDirection = VISUALIZER_DEFAULTS.hypnoDirection;
	}
	if (typeof merged.hypnoModeRefreshRate !== "number") {
		merged.hypnoModeRefreshRate = VISUALIZER_DEFAULTS.hypnoModeRefreshRate;
	}
	if (merged.dotRadiusMode !== "actual" && merged.dotRadiusMode !== "spherical") {
		merged.dotRadiusMode = VISUALIZER_DEFAULTS.dotRadiusMode;
	}
	// @what - lazy-fill particle glyph for configs saved before dotShape existed
	if (
		merged.dotShape !== "circle" &&
		merged.dotShape !== "triangle" &&
		merged.dotShape !== "square" &&
		merged.dotShape !== "pentagon" &&
		merged.dotShape !== "hexagon"
	) {
		merged.dotShape = VISUALIZER_DEFAULTS.dotShape;
	}
	// @what - lazy-fill layout mode + spin for configs saved before layoutMode existed
	if (
		merged.layoutMode !== "sphere" &&
		merged.layoutMode !== "disc" &&
		merged.layoutMode !== "cylinder" &&
		merged.layoutMode !== "torus"
	) {
		merged.layoutMode = VISUALIZER_DEFAULTS.layoutMode;
	}
	if (typeof merged.layoutSpinSpeed !== "number") {
		merged.layoutSpinSpeed = VISUALIZER_DEFAULTS.layoutSpinSpeed;
	}
	if (merged.layoutSpinDirection !== "normal" && merged.layoutSpinDirection !== "reverse") {
		merged.layoutSpinDirection = VISUALIZER_DEFAULTS.layoutSpinDirection;
	}
	if (merged.layoutSpinAxis !== "x" && merged.layoutSpinAxis !== "y" && merged.layoutSpinAxis !== "z") {
		merged.layoutSpinAxis = VISUALIZER_DEFAULTS.layoutSpinAxis;
	}
	// @what - lazy-fill stationary orient angles for configs saved before layoutOrient* existed
	if (typeof merged.layoutOrientX !== "number") {
		merged.layoutOrientX = VISUALIZER_DEFAULTS.layoutOrientX;
	}
	if (typeof merged.layoutOrientY !== "number") {
		merged.layoutOrientY = VISUALIZER_DEFAULTS.layoutOrientY;
	}
	if (typeof merged.layoutOrientZ !== "number") {
		merged.layoutOrientZ = VISUALIZER_DEFAULTS.layoutOrientZ;
	}
	if (typeof merged.overlaySampleCount !== "number") {
		merged.overlaySampleCount = VISUALIZER_DEFAULTS.overlaySampleCount;
	}
	if (typeof merged.overlayAngleOffsetDeg !== "number") {
		merged.overlayAngleOffsetDeg = VISUALIZER_DEFAULTS.overlayAngleOffsetDeg;
	}
	if (!Array.isArray(merged.overlayAnglesDeg)) {
		merged.overlayAnglesDeg = [...VISUALIZER_DEFAULTS.overlayAnglesDeg];
	}
	if (!merged.overlayBlendMode) {
		merged.overlayBlendMode = VISUALIZER_DEFAULTS.overlayBlendMode;
	}
	// @what - lazy-fill spatial blur coeffs for configs saved before blurX/blurY existed
	if (typeof merged.blurX !== "number") {
		merged.blurX = VISUALIZER_DEFAULTS.blurX;
	}
	if (typeof merged.blurY !== "number") {
		merged.blurY = VISUALIZER_DEFAULTS.blurY;
	}
	// @what - lazy-fill Tune knobs added after blurX/Y (08-07-2026)
	if (typeof merged.clearAfterFrames !== "number") {
		merged.clearAfterFrames = VISUALIZER_DEFAULTS.clearAfterFrames;
	}
	if (typeof merged.blurKernelQuality !== "number") {
		merged.blurKernelQuality = VISUALIZER_DEFAULTS.blurKernelQuality;
	}
	if (typeof merged.noiseOffsetScale !== "number") {
		merged.noiseOffsetScale = VISUALIZER_DEFAULTS.noiseOffsetScale;
	}
	if (typeof merged.amplitudeWindow !== "number") {
		merged.amplitudeWindow = VISUALIZER_DEFAULTS.amplitudeWindow;
	}
	// @what - ensure spherical-path clamp multipliers exist on old dotRadius snapshots
	if (merged.dotRadius && typeof merged.dotRadius === "object") {
		if (typeof (merged.dotRadius as any).multiplierLow !== "number") {
			(merged.dotRadius as any).multiplierLow = VISUALIZER_DEFAULTS.dotRadius.multiplierLow;
		}
		if (typeof (merged.dotRadius as any).multiplierHigh !== "number") {
			(merged.dotRadius as any).multiplierHigh = VISUALIZER_DEFAULTS.dotRadius.multiplierHigh;
		}
	}
	return merged;
}

// @@ getBasedOn
export function getBasedOn(): string | null {
	return window.visualizerCurrentConfig?.basedOn ?? currentName;
}

// @@ persistCurrentConfig
// @purpose - Write the live session to localStorage + window mirror after every tweak
export function persistCurrentConfig(basedOn: string | null = getBasedOn()): VisualizerCurrentConfig {
	const values = normalizeVisualizerValues(window.visualizer);
	window.visualizer = values;
	const payload: VisualizerCurrentConfig = { basedOn, values: deepClone(values) };
	window.visualizerCurrentConfig = payload;
	localStorage.setItem(CURRENT_CONFIG_KEY, JSON.stringify(payload));
	if (basedOn !== null) {
		localStorage.setItem("mm.visualizer.lastUsedName", basedOn);
	}
	return payload;
}

// @@ readStoredCurrentConfig
// @return - {VisualizerCurrentConfig|null}
export function readStoredCurrentConfig(): VisualizerCurrentConfig | null {
	try {
		const parsed = JSON.parse(localStorage.getItem(CURRENT_CONFIG_KEY) ?? "null");
		if (!parsed || typeof parsed !== "object" || !parsed.values) return null;
		return {
			basedOn: typeof parsed.basedOn === "string" ? parsed.basedOn : null,
			values: normalizeVisualizerValues(parsed.values),
		};
	} catch {
		return null;
	}
}

// @@ applyLiveValues
// @how - Replace window.visualizer, sync hypno, setCurrent against named baseline, persist currentConfig
// @because - pristine must be CONFIGS[basedOn] (not the possibly-dirty live values) so isDirty() stays honest after reload
export function applyLiveValues(values: VisualizerConfigValues, basedOn: string | null): void {
	window.visualizer = normalizeVisualizerValues(values);
	syncHypnoGlobalsFromVisualizer(window.visualizer);
	if (basedOn && getConfigs()[basedOn]) {
		setCurrent(basedOn, normalizeVisualizerValues(getConfigs()[basedOn]));
	} else {
		setCurrent(null);
	}
	persistCurrentConfig(basedOn);
}

// @@ notifyVisualizerChanged
// @desc - After in-place mutation of window.visualizer, sync hypno globals + persist session
// @how - Config object is the source of truth; globals are derived from it
export function notifyVisualizerChanged(): void {
	syncHypnoGlobalsFromVisualizer(window.visualizer);
	persistCurrentConfig();
}

// @@ hydrateVisualizerSession
// @when - 07-26-2026
// @desc - Startup entry: run hypno migration, then prefer currentConfig over lastUsedName
export function hydrateVisualizerSession(): void {
	migrateHypnoIntoConfigs();

	const storedCurrent = readStoredCurrentConfig();
	if (storedCurrent) {
		applyLiveValues(storedCurrent.values, storedCurrent.basedOn);
		return;
	}

	const visualizerName = localStorage.getItem("mm.visualizer.lastUsedName");
	const storedConfigs = getConfigs();
	const names = Object.keys(storedConfigs);

	if (visualizerName && storedConfigs[visualizerName]) {
		applyLiveValues(storedConfigs[visualizerName], visualizerName);
		return;
	}
	if (names.length > 0) {
		const lastName = names[names.length - 1];
		applyLiveValues(storedConfigs[lastName], lastName);
		return;
	}

	const fresh = deepClone(VISUALIZER_DEFAULTS);
	fresh.createdAt = new Date().toISOString();
	// @how - seed hypno from legacy globals when no named configs exist yet
	fresh.hypnoMode = localStorageGetBool("mm.visualizer.hypnoMode", false);
	fresh.hypnoDirection = booleanToDirection(localStorageGetBool("mm.visualizer.hypnoDirection", true));
	applyLiveValues(fresh, null);
}

function localStorageGetBool(key: string, fallback: boolean): boolean {
	const v = localStorage.getItem(key);
	if (v === null) return fallback;
	return v === "true";
}

// @@ saveNewConfig
// @desc - Append a brand new named config at the END of the configs object
// @param - name {String} validated, unused name
// @param - values {Object} config values to store
// @how - Always stamp a fresh createdAt so new saves record creation time, not module-load defaults
export function saveNewConfig(name: string, values: VisualizerConfigValues) {
	const configs = getConfigs();
	const stamped: VisualizerConfigValues = {
		...normalizeVisualizerValues(values),
		createdAt: new Date().toISOString(),
	};
	configs[name] = stamped;
	writeConfigs(configs);
	window.visualizer = deepClone(stamped);
	syncHypnoGlobalsFromVisualizer(window.visualizer);
	setCurrent(name, stamped);
	persistCurrentConfig(name);
}

// @@ overwriteConfig
// @desc - Replace an existing config's values (and possibly its name) WITHOUT changing its position
// @how - Rebuild the object key-by-key, swapping in the new name/values where the old key sat
// @and - Preserve the original createdAt so overwrites never look like new creations
export function overwriteConfig(oldName: string, newName: string, values: VisualizerConfigValues) {
	const configs = getConfigs();
	const rebuilt: ConfigMap = {};
	const stamped: VisualizerConfigValues = {
		...normalizeVisualizerValues(values),
		createdAt: configs[oldName]?.createdAt ?? values.createdAt,
	};
	for (const key of Object.keys(configs)) {
		if (key === oldName) {
			rebuilt[newName] = stamped;
		} else {
			rebuilt[key] = configs[key];
		}
	}
	writeConfigs(rebuilt);
	window.visualizer = deepClone(stamped);
	syncHypnoGlobalsFromVisualizer(window.visualizer);
	setCurrent(newName, stamped);
	persistCurrentConfig(newName);
}

// @@ setCurrent
// @desc - Mark a config as the "loaded" one and remember its pristine values for dirty-checking
// @param - name {String|null} null = unsaved/new config
// @optional - values {Object} pristine values; defaults to the live window.visualizer
export function setCurrent(name: string | null, values?: VisualizerConfigValues) {
	currentName = name;
	pristineSnapshot = name === null ? null : JSON.stringify(values ?? window.visualizer);
	localStorage.setItem("mm.visualizer.lastUsedName", name ?? "");
}

// @@ getCurrentName
// @return - {String|null} name of the loaded config, or null when working on an unsaved config
export function getCurrentName(): string | null {
	return currentName;
}

// @@ isDirty
// @desc - Has the user tweaked values since the current config was loaded/saved?
// @how - Cheap structural compare via JSON.stringify against the pristine snapshot
// @return - {Boolean} true when there are unsaved changes (always true for unsaved configs)
export function isDirty(): boolean {
	if (currentName === null || pristineSnapshot === null) return true;
	return JSON.stringify(window.visualizer) !== pristineSnapshot;
}

// [[config.configStore.baseline]]
// @@ getBaseline
// @desc - Source-of-truth values for per-field revert (named CONFIG or defaults)
export function getBaseline(): VisualizerConfigValues {
	const basedOn = getBasedOn();
	if (basedOn) {
		const stored = getConfigs()[basedOn];
		if (stored) return normalizeVisualizerValues(stored);
	}
	return deepClone(VISUALIZER_DEFAULTS);
}

// @@ isFieldDirty
// @param - key {String} top-level visualizer key
export function isFieldDirty(key: ConfigFieldKey): boolean {
	if (META_KEYS.has(key)) return false;
	const live = (window.visualizer as any)[key];
	const base = (getBaseline() as any)[key];
	return JSON.stringify(live) !== JSON.stringify(base);
}

// @@ isRangePartDirty
// @what - compare one nested numeric on a range-like object (min/max/multiplier*)
export function isRangePartDirty(key: ConfigFieldKey, which: RangePart): boolean {
	const live = (window.visualizer as any)[key];
	const base = (getBaseline() as any)[key];
	if (!live || typeof live !== "object" || !base || typeof base !== "object") return isFieldDirty(key);
	return live[which] !== base[which];
}

// @@ countDirtyFields
// @return - {Number} rough count of top-level dirty keys (ranges count once if any part dirty)
export function countDirtyFields(): number {
	let n = 0;
	for (const key of Object.keys(VISUALIZER_DEFAULTS) as ConfigFieldKey[]) {
		if (META_KEYS.has(key)) continue;
		if (isFieldDirty(key)) n += 1;
	}
	return n;
}

// @@ revertField
// @how - Copy the entire baseline value for `key` onto the live visualizer
export function revertField(key: ConfigFieldKey): void {
	if (META_KEYS.has(key)) return;
	const baseline = getBaseline();
	(window.visualizer as any)[key] = deepClone((baseline as any)[key]);
	notifyVisualizerChanged();
}

// @@ revertRangePart
// @what - restore one nested numeric (min/max/multiplier*) from baseline without clobbering siblings
export function revertRangePart(key: ConfigFieldKey, which: RangePart): void {
	const baseline = getBaseline();
	const live = (window.visualizer as any)[key];
	const base = (baseline as any)[key];
	if (!live || typeof live !== "object" || !base || typeof base !== "object") {
		revertField(key);
		return;
	}
	(window.visualizer as any)[key] = { ...live, [which]: base[which] };
	notifyVisualizerChanged();
}

// @@ revertAllToBaseline
// @purpose - Restore every controllable field from the based-on config (or defaults)
export function revertAllToBaseline(): void {
	const basedOn = getBasedOn();
	const baseline = getBaseline();
	const createdAt = window.visualizer?.createdAt ?? baseline.createdAt;
	window.visualizer = { ...deepClone(baseline), createdAt };
	syncHypnoGlobalsFromVisualizer(window.visualizer);
	setCurrent(basedOn, basedOn ? getConfigs()[basedOn] ?? baseline : null);
	persistCurrentConfig(basedOn);
}

// @@ getBaselineField
export function getBaselineField<K extends ConfigFieldKey>(key: K): VisualizerConfigValues[K] {
	return getBaseline()[key];
}

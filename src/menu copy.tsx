import React from "react";
import { RendererDefinition } from "./app";
import VisualizerControls, { openVisualizerControls } from "./components/VisualizerControls";
import ControlsInMenu from "./components/ControlsInMenu";
// [[@components.configManager]]
import { openSaveConfigDialog, CurrentConfigNameItem, ConfigsList } from "./components/ConfigManager";

const SpotifyIcon = React.memo((props: { name: Spicetify.Icon; size: number }) => (
	<Spicetify.ReactComponent.IconComponent
		semanticColor="textBase"
		dangerouslySetInnerHTML={{ __html: Spicetify.SVGIcons[props.name] }}
		iconSize={props.size}
	/>
));
type MainMenuProps = {
	renderers: RendererDefinition[];
	onSelectRenderer: (id: string) => void;
	onOpenWindow: () => void;
	useSongPalette: boolean;
	onToggleSongPalette: () => void;
};

type OverlayBlendMode = typeof import("./config/visualizer.defaults").VISUALIZER_DEFAULTS["overlayBlendMode"];

const OVERLAY_BLEND_MODE_OPTIONS: { mode: OverlayBlendMode; label: string }[] = [
	{ mode: "alpha_mix", label: "Linear Alpha Mix" },
	{ mode: "additive", label: "Additive" },
	{ mode: "max", label: "Max / Lighten" }
];

// @what - normalize possibly-missing persisted values from old configs
const getOverlayBlendMode = (): OverlayBlendMode => {
	const mode = localStorage.getItem("mm.visualizer.lastOverlayBlendMode") || window.visualizer?.overlayBlendMode;
	return mode === "additive" || mode === "max" ? mode : "alpha_mix";
};

// [[menu.main]]
// @what - Context menu to pick renderer and open a secondary window
// @? - Uses Spotify’s React components so it fits native UI
const MainMenu = React.memo((props: MainMenuProps) => (
	<Spicetify.ReactComponent.Menu>
		{/*
		<Spicetify.ReactComponent.Menu displayText="Renderer">
			{props.renderers.map(v => (
				<Spicetify.ReactComponent.MenuItem onClick={() => props.onSelectRenderer(v.id)}>
					{v.name}
				</Spicetify.ReactComponent.MenuItem>
			))}
		</Spicetify.ReactComponent.Menu>
		*/}
		{/* [[menu.save.config]] */}
		{/* [[@configManager.openSaveDialog]] */}
		{/* @when - 06-12-2026 */}
		{/* @what - Save flow moved near the top so the CONFIGS dropdown below gets the vertical space */}
		{/* @how - Opens a PopupModal asking overwrite-vs-new + a name; persistence lives in configStore.ts */}
		<Spicetify.ReactComponent.MenuItem onClick={() => openSaveConfigDialog()}>
			SAVE CURRENT CONFIG
		</Spicetify.ReactComponent.MenuItem>
		{/* @what - Loaded config's name; click to rename (confirm -> immediate overwrite) */}
		{/* [[@configManager.currentNameItem]] */}
		<CurrentConfigNameItem />
		{/* @what - Scrollable dropdown of saved configs, newest first, with "Create a New CONFIG" on top */}
		{/* [[@configManager.configsList]] */}
		<Spicetify.ReactComponent.Menu displayText="CONFIGS">
			<ConfigsList />
		</Spicetify.ReactComponent.Menu>
		<Spicetify.ReactComponent.MenuItem disabled={true} onClick={(e: React.MouseEvent<HTMLDivElement>) => {
			window.visualizerHypnoMode = !window.visualizerHypnoMode;
			localStorage.setItem("mm.visualizer.hypnoMode", window.visualizerHypnoMode ? "true" : "false");
			const button = document.querySelector(".hypno-mode-button");
			if (button?.classList.contains("HYPNOTOAD")) {
				button?.classList.remove("HYPNOTOAD");
			} else {
				button?.classList.add("HYPNOTOAD");
			}
			const canvas = document.querySelector(".visualizer-canvas");
			if (canvas?.classList.contains("HYPNOTOAD")) {
				canvas.classList.remove("HYPNOTOAD");
			} else {
				canvas?.classList.add("HYPNOTOAD");
			}
		}}>
			<div className={`hypno-mode-button ${window.visualizerHypnoMode ? "HYPNOTOAD" : ""}`}>🐸 HYPNOTOAD</div>
		</Spicetify.ReactComponent.MenuItem>
		<Spicetify.ReactComponent.MenuItem disabled={true} onClick={(e: React.MouseEvent<HTMLDivElement>) => {
			props.onToggleSongPalette();
		}}>
			{props.useSongPalette ? "🎨 Use Default Palette" : "🎨 Use Song Palette"}
		</Spicetify.ReactComponent.MenuItem>
		<div className="overlay-blend-menu">
			<Spicetify.ReactComponent.Menu displayText="Overlay Blend">
				{OVERLAY_BLEND_MODE_OPTIONS.map(({ mode, label }) => (
					<Spicetify.ReactComponent.MenuItem disabled={true} key={mode} onClick={(e: React.MouseEvent<HTMLDivElement>) => {
						window.visualizer.overlayBlendMode = mode;
						window.visualizerLastOverlayBlendMode = mode;
						localStorage.setItem("mm.visualizer.lastOverlayBlendMode", mode);
						const modeButtons = document.querySelectorAll(".overlay-blend-mode");
						modeButtons.forEach(button => {
							button.classList.remove("active");
						});
						const activeButton = document.querySelector(`.overlay-blend-mode-${mode}`);
						activeButton?.classList.add("active");
						e.currentTarget?.blur();
					}}>
						<div className={`overlay-blend-mode overlay-blend-mode-${mode} ${getOverlayBlendMode() === mode ? "active" : ""}`}>{label}</div>
					</Spicetify.ReactComponent.MenuItem>
				))}
			</Spicetify.ReactComponent.Menu>
		</div>
		<Spicetify.ReactComponent.MenuItem disabled={true}
			onClick={(e: React.MouseEvent<HTMLDivElement>) => {
				props.onOpenWindow();
			}}
			trailingIcon={<SpotifyIcon name="external-link" size={16} />}
		>
			Open Window
		</Spicetify.ReactComponent.MenuItem>
		<Spicetify.ReactComponent.Menu displayText="Controls">
			<ControlsInMenu />
		</Spicetify.ReactComponent.Menu>
	</Spicetify.ReactComponent.Menu>
));

export const MainMenuButton = React.memo((props: MainMenuProps & { className: string }) => {
	// @how - Renders as an icon-only button that triggers the inline context menu
	return (
		<Spicetify.ReactComponent.ContextMenu trigger="click" menu={<MainMenu {...props} />}>
			<Spicetify.ReactComponent.ButtonSecondary
				aria-label="menu"
				className={props.className}
				iconOnly={() => <SpotifyIcon name="menu" size={16} />}
			></Spicetify.ReactComponent.ButtonSecondary>
		</Spicetify.ReactComponent.ContextMenu>
	);
});

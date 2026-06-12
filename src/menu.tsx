import React from "react";
import { RendererDefinition } from "./app";
import VisualizerControls, { openVisualizerControls } from "./components/VisualizerControls";
import ControlsInMenu from "./components/ControlsInMenu";
import { VISUALIZER_DEFAULTS } from "./config/visualizer.defaults";

const SpotifyIcon = React.memo((props: { name: Spicetify.Icon; size: number }) => (
	<Spicetify.ReactComponent.IconComponent
		semanticColor="textBase"
		dangerouslySetInnerHTML={{ __html: Spicetify.SVGIcons[props.name] }}
		iconSize={props.size}
	/>
));

type MainMenuProps = { renderers: RendererDefinition[]; onSelectRenderer: (id: string) => void; onOpenWindow: () => void };

// [[menu.main]]
// @what - Context menu to pick renderer and open a secondary window
// @? - Uses Spotify’s React components so it fits native UI
const MainMenu = React.memo((props: MainMenuProps) => (
	<Spicetify.ReactComponent.Menu>
		<Spicetify.ReactComponent.Menu displayText="Renderer">
			{props.renderers.map(v => (
				<Spicetify.ReactComponent.MenuItem onClick={() => props.onSelectRenderer(v.id)}>
					{v.name}
				</Spicetify.ReactComponent.MenuItem>
			))}
		</Spicetify.ReactComponent.Menu>
		<Spicetify.ReactComponent.MenuItem onClick={() => {
			const canvas = document.querySelector(".visualizer-canvas");
			if (canvas?.classList.contains("HYPNOTOAD")) {
				canvas.classList.remove("HYPNOTOAD");
			} else {
				canvas?.classList.add("HYPNOTOAD");
			}
		}}>
			`🐸 HYPNOTOAD`
		</Spicetify.ReactComponent.MenuItem>
		<Spicetify.ReactComponent.MenuItem
			onClick={() => props.onOpenWindow()}
			trailingIcon={<SpotifyIcon name="external-link" size={16} />}
		>
			Open Window
		</Spicetify.ReactComponent.MenuItem>
		<Spicetify.ReactComponent.Menu displayText="Controls">
			<ControlsInMenu />
		</Spicetify.ReactComponent.Menu>
		<Spicetify.ReactComponent.MenuItem onClick={() => {
			let storedConfigs: typeof VISUALIZER_DEFAULTS[] = JSON.parse(localStorage.getItem("mm.visualizer.CONFIGS") ?? "[]");
			storedConfigs.push(JSON.parse(JSON.stringify(window.visualizer)));
			localStorage.setItem("mm.visualizer.CONFIGS", JSON.stringify(storedConfigs));
			console.gold("[NCSVisualizer] Saved current config", window.visualizer);
			(Spicetify?.showMotification("Current config saved", "success")) ?? (Spicetify?.showNotification("Current config saved"));
		}}>
			SAVE CURRENT CONFIG
		</Spicetify.ReactComponent.MenuItem>
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

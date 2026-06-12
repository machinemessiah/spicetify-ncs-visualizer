import React, { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./css/app.module.scss";
import LoadingIcon from "./components/LoadingIcon";
import NCSVisualizer from "./components/renderer/NCSVisualizer";
import { CacheStatus, ExtensionKind, MetadataService } from "./metadata";
import { parseProtobuf } from "./protobuf/defs";
import { ColorResult } from "./protobuf/ColorResult";
import { ErrorData, ErrorHandlerContext, ErrorRecovery } from "./error";
import DebugVisualizer from "./components/renderer/DebugVisualizer";
import SpectrumVisualizer from "./components/renderer/SpectrumVisualizer";
import { MainMenuButton } from "./menu";
import { createVisualizerWindow } from "./window";

export type RendererProps = {
	isEnabled: boolean;
	themeColor: Spicetify.Color;
	audioAnalysis?: SpotifyAudioAnalysis;
	rotation?: number;
};

export type RendererDefinition = {
	id: string;
	name: string;
	renderer: React.FunctionComponent<RendererProps>;
};

// [[app.renderers]]
// @what - Available visualizer renderers exposed in UI
const RENDERERS: RendererDefinition[] = [
	{
		id: "ncs",
		name: "NCS",
		renderer: NCSVisualizer
	},
	{
		id: "spectrum",
		name: "Spectrum (very WIP)",
		renderer: SpectrumVisualizer
	},
	{
		id: "debug",
		name: "DEBUG",
		renderer: DebugVisualizer
	}
];

// [[app.state]]
// @what - Visualizer state machine: loading → running, or error with recovery strategy
type VisualizerState =
	| {
			state: "loading" | "running";
	  }
	| {
			state: "error";
			errorData: ErrorData;
	  };

export default function App(props: { isSecondaryWindow?: boolean; initialRenderer?: string }) {
	// @value (rendererId) - currently selected renderer id from menu or initial prop
	const [rendererId, setRendererId] = useState<string>(props.initialRenderer || "ncs");
	const Renderer = RENDERERS.find(v => v.id === rendererId)?.renderer;

	// @values - visualizer state and track-dependent data (audio analysis + theme color)
	const [state, setState] = useState<VisualizerState>({ state: "loading" });
	const [trackData, setTrackData] = useState<{ audioAnalysis?: SpotifyAudioAnalysis; themeColor: Spicetify.Color }>({
		themeColor: Spicetify.Color.fromHex("#535353")
	});

	// [[app.errors]]
	// @how - Gate unrecoverable errors so UI doesn't flicker back to loading
	const updateState = useCallback(
		(newState: VisualizerState) =>
			setState(oldState => {
				if (oldState.state === "error" && oldState.errorData.recovery === ErrorRecovery.NONE) return oldState;

				return newState;
			}),
		[]
	);

	const onError = useCallback((msg: string, recovery: ErrorRecovery) => {
		updateState({
			state: "error",
			errorData: {
				message: msg,
				recovery
			}
		});
	}, []);

	const isUnrecoverableError = state.state === "error" && state.errorData.recovery === ErrorRecovery.NONE;

	// [[app.metadata]]
	// @what - Service to fetch extracted album art color via Spotify's internal metadata APIs
	const metadataService = useMemo(() => new MetadataService(), []);

	// [[app.updatePlayerState]]
	// @what - Loads audio analysis JSON + extracted color for current track
	// @how - Validates track type, handles cosmos errors, maps color protobuf to CSS color
	const updatePlayerState = useCallback(
		async (newState: Spicetify.PlayerState) => {
			const item = newState?.item;

			if (!item) {
				onError("Start playing a song to see the visualization!", ErrorRecovery.SONG_CHANGE);
				return;
			}

			const uri = Spicetify.URI.fromString(item.uri);
			if (uri.type !== Spicetify.URI.Type.TRACK) {
				onError("Error: The type of track you're listening to is currently not supported", ErrorRecovery.SONG_CHANGE);
				return;
			}

			updateState({ state: "loading" });

			// @values - parallel fetch: analysis JSON + extracted color (protobuf)
			const analysisRequestUrl = `https://spclient.wg.spotify.com/audio-attributes/v1/audio-analysis/${uri.id}?format=json`;
			const [audioAnalysis, vibrantColor] = await Promise.all([
				Spicetify.CosmosAsync.get(analysisRequestUrl).catch(e => console.error("[Visualizer]", e)) as Promise<unknown>,
				metadataService
					.fetch(ExtensionKind.EXTRACTED_COLOR, item.metadata.image_url)
					.catch(s => console.error(`[Visualizer] Could not load extracted color metadata. Status: ${CacheStatus[s]}`))
					.then(colors => {
						if (
							!colors ||
							colors.value.length === 0 ||
							colors.typeUrl !== "type.googleapis.com/spotify.context_track_color.ColorResult"
						)
							return Spicetify.Color.fromHex("#535353");

						const colorResult = parseProtobuf(colors.value, ColorResult);
						const colorHex = colorResult.colorLight?.rgb?.toString(16).padStart(6, "0") ?? "535353";
						return Spicetify.Color.fromHex(`#${colorHex}`);
					})
			]);

			// @what - Handle network/protobuf failures and malformed responses
			if (!audioAnalysis) {
				onError(
					"Error: The audio analysis could not be loaded, please check your internet connection",
					ErrorRecovery.MANUAL
				);
				return;
			}

			if (typeof audioAnalysis !== "object") {
				onError(`Invalid audio analysis data (${audioAnalysis})`, ErrorRecovery.MANUAL);
				return;
			}

			if (!("track" in audioAnalysis) || !("segments" in audioAnalysis)) {
				const message =
					"error" in audioAnalysis && audioAnalysis.error
						? (audioAnalysis.error as string)
						: "message" in audioAnalysis && audioAnalysis.message
							? (audioAnalysis.message as string)
							: "Unknown error";

				const code = "code" in audioAnalysis ? (audioAnalysis.code as number) : null;

				if (code !== null) {
					onError(`Error ${code}: ${message}`, ErrorRecovery.MANUAL);
					return;
				} else {
					onError(message, ErrorRecovery.MANUAL);
					return;
				}
			}

			// @meaning - Successful load; hand to renderer
			setTrackData({ audioAnalysis: audioAnalysis as SpotifyAudioAnalysis, themeColor: vibrantColor });
			updateState({ state: "running" });
		},
		[metadataService]
	);


	// [[app.playerListeners]]
	// @what - Subscribe to song changes to refresh analysis/color automatically
	useEffect(() => {
		if (isUnrecoverableError) return;

		const songChangeListener = (event?: Event & { data: Spicetify.PlayerState }) => {
			if (event?.data) updatePlayerState(event.data);
		};

		Spicetify.Player.addEventListener("songchange", songChangeListener);
		updatePlayerState(Spicetify.Player.data);

		return () => Spicetify.Player.removeEventListener("songchange", songChangeListener as PlayerEventListener);
	}, [isUnrecoverableError, updatePlayerState]);

	// [[app.ui]]
	// @what - Render active renderer + menu button (hidden in secondary window), and error/loading UI
	return (
		<div className="visualizer-container">
			{!isUnrecoverableError && (
				<>
					<ErrorHandlerContext.Provider value={onError}>
						{Renderer && (
							<Renderer
								isEnabled={state.state === "running"}
								audioAnalysis={trackData.audioAnalysis}
								themeColor={trackData.themeColor}
							/>
						)}
					</ErrorHandlerContext.Provider>
					{props.isSecondaryWindow || (
						<MainMenuButton
							className={styles.main_menu_button}
							renderers={RENDERERS}
							onOpenWindow={() => {
								if (!createVisualizerWindow(rendererId)) {
									Spicetify.showNotification("Failed to open a new window", true);
								}
							}}
							onSelectRenderer={id => setRendererId(id)}
						/>
					)}
				</>
			)}

			{state.state === "loading" ? (
				<LoadingIcon />
			) : state.state === "error" ? (
				<div className={styles.error_container}>
					<div className={styles.error_message}>{state.errorData.message}</div>
					{state.errorData.recovery === ErrorRecovery.MANUAL && (
						<Spicetify.ReactComponent.ButtonPrimary onClick={() => updatePlayerState(Spicetify.Player.data)}>
							Try again
						</Spicetify.ReactComponent.ButtonPrimary>
					)}
				</div>
			) : null}
		</div>
	);
}

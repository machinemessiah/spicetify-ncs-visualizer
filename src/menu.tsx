// [[menu.studioToggle]]
// @when - 07-27-2026
// @what - Legacy menu entrypoint retired; Studio lives in VisualizerStudio.tsx
// @how - Re-export toggle helpers for any lingering imports during the migration

export { default as VisualizerStudio, StudioToggleButton } from "./components/VisualizerStudio";

import React from "react";
import App from "./app";

// [[window.create]]
// @what - Spawn a new window for the visualizer and clone styles from the main document
// @how - Copy <link rel=stylesheet> and <style> tags, mirror body/html classes, then mount <App/>
export function createVisualizerWindow(rendererId: string) {
	try {
		const win = window.open();
		if (!win) return false;

		document.querySelectorAll("link[rel=stylesheet]").forEach(e => {
			const newElement = win.document.createElement("link");
			newElement.setAttribute("rel", "stylesheet");
			newElement.setAttribute("href", (e as HTMLLinkElement).href);

			win.document.head.appendChild(newElement);
		});
		document.querySelectorAll("style").forEach(e => {
			const newElement = win.document.createElement("style");
			newElement.innerText = e.innerText;

			win.document.head.appendChild(newElement);
		});

		win.document.documentElement.className = document.documentElement.className;
		win.document.body.className = document.body.className;

		// @how - Render App in isolated document with `isSecondaryWindow` to hide menu button
		Spicetify.ReactDOM.render(<App isSecondaryWindow={true} initialRenderer={rendererId} />, win.document.body);

		return true;
	} catch {
		return false;
	}
}

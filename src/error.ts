import { createContext } from "react";

export type ErrorHandler = (msg: string, recovery: ErrorRecovery) => void;

export const ErrorHandlerContext = createContext<ErrorHandler>(() => {});

// [[error.types]]
// @what - Error handler signature + recovery hints to control retry strategy
export enum ErrorRecovery {
	MANUAL,      // @meaning - show retry button (user action)
	SONG_CHANGE, // @meaning - retry when song changes
	NONE         // @meaning - unrecoverable; keep error visible until reload
}

export type ErrorData = {
	message: string;
	recovery: ErrorRecovery;
};

// Faithful re-implementation of the fork's native "Move To Here" motion, built
// entirely on the plugin SDK bridge instead of privileged host access.
//
// Native source (gSender `origin/dev`):
//   src/app/src/features/DRO/utils/SafeMove.ts   -> getSafeRetractCode / getSafeXYMoveCode
//   src/app/src/features/Visualizer/GcodeViewer.tsx (commitMoveToHere)
//
// The host bridge maps `machine.command(cmd, ...args)` straight onto
// `controller.command(cmd, ...args)`, and exposes the app `store` "workspace"
// slice plus the redux root, so every value the native code read from
// `store.get(...)` / `controller.*` is reconstructable here.

const GRBL_ACTIVE_STATE_IDLE = "Idle";

/** Minimal view of the redux root the safe-move math needs. */
export type ReduxSnapshot = {
	connection?: { isConnected?: boolean };
	controller?: {
		// EEPROM settings, e.g. `$22` (homing enable).
		settings?: { settings?: Record<string, unknown> };
		// Live status feedback (machine position, active state).
		state?: { status?: { activeState?: string; mpos?: { z?: unknown } } };
	};
};

/** Minimal view of the app `store` "workspace" slice. */
export type WorkspaceSnapshot = {
	units?: string;
	safeRetractHeight?: unknown;
};

const num = (value: unknown, fallback = 0): number => {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
};

/**
 * Mirror of native `machineIsReadyToMove()` / the host's idle gate: picking
 * drives a real rapid, so refuse unless the machine is connected and idle.
 */
export const machineIsReadyToMove = (redux: ReduxSnapshot): boolean => {
	const isConnected = !!redux?.connection?.isConnected;
	const activeState = redux?.controller?.state?.status?.activeState;
	return isConnected && activeState === GRBL_ACTIVE_STATE_IDLE;
};

/**
 * Port of native `getSafeRetractCode()`.
 *
 * Retract Z to the user's configured safe height before a rapid XY move:
 *  - `safeRetractHeight === 0` -> no retract.
 *  - homing enabled (`$22 !== 0`) -> retract in machine space (`G53`), but only
 *    when the spindle currently sits below the safe height.
 *  - homing disabled -> incremental retract (`G91`); the caller re-establishes
 *    absolute mode afterwards.
 */
export const getSafeRetractCode = (
	redux: ReduxSnapshot,
	workspace: WorkspaceSnapshot,
): string[] => {
	const code: string[] = [];
	const retractHeight = num(workspace?.safeRetractHeight, -1);

	if (retractHeight === 0) {
		return code;
	}

	const settings = redux?.controller?.settings?.settings ?? {};
	const homingEnabled = num((settings as Record<string, unknown>).$22, 0) !== 0;

	if (homingEnabled) {
		const currentZ = num(redux?.controller?.state?.status?.mpos?.z, 0);
		const retract = Math.abs(retractHeight) * -1;
		if (currentZ < retract) {
			code.push(`G53 G0 Z${retract}`);
		}
	} else {
		code.push("G91");
		code.push(`G0Z${retractHeight}`);
	}

	return code;
};

/**
 * Port of native `getSafeXYMoveCode(x, y)`: "retract to safe Z, then rapid to
 * absolute work XY". The spindle is parked at the safe height over the target;
 * it is never plunged back down.
 */
export const getSafeXYMoveCode = (
	x: number,
	y: number,
	redux: ReduxSnapshot,
	workspace: WorkspaceSnapshot,
): string[] => {
	const code = getSafeRetractCode(redux, workspace);
	code.push("G90", `G0 X${x} Y${y}`);
	return code;
};

/** Native rounds the raycast hit to 3 decimals before building the move. */
export const roundCoord = (value: number): number => Number(value.toFixed(3));

/** Native: `units === METRIC_UNITS ? "G21" : "G20"`. */
export const unitModalFor = (units: string | undefined): "G21" | "G20" =>
	units === "in" ? "G20" : "G21";

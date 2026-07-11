import { gsender, type OverlayMarker } from "@sienci/gsender-plugin-sdk";
import {
	useTypedSelector,
	useVisualizerPick,
	useWorkspaceState,
} from "@sienci/gsender-plugin-sdk/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
	DEFAULT_SCREWSPOT_PARAMS,
	type ScrewSpotParams,
	type ScrewSpotPoint,
	screwSpotHeightsReason,
} from "./definitions";
import { getSafeRetractCode } from "./safeRetract";
import { ScrewSpotPanel } from "./ScrewSpotPanel";
import { generateScrewSpotGcode } from "./screwSpotGcodeGenerator";

// --- gSender constants mirrored locally (the plugin can't import `app/*`) -------
const GRBLHAL = "grblHAL";
const GRBL_ACTIVE_STATE_IDLE = "Idle";

// --- Bridge state shapes (only the slices we read) ------------------------------
type WorkspaceState = {
	units?: string;
	safeRetractHeight?: number | string;
};

type ReduxState = {
	connection?: { isConnected?: boolean };
	controller?: {
		type?: string;
		state?: { status?: { activeState?: string; mpos?: { z?: number } } };
		settings?: { settings?: Record<string, unknown> };
		mpos?: { z?: number };
	};
	file?: { fileType?: string | null };
};

// Screw Spot params are stored canonically in millimetres; these fields convert for
// imperial display/entry (spindle RPM, dwell seconds and enums stay unit-agnostic) —
// mirrors the native SCREW_SPOT_LENGTH_FIELDS handling.
const MM_PER_IN = 25.4;
const LENGTH_FIELDS = [
	"travelHeight",
	"plungeHeight",
	"drillDepth",
	"peckDepth",
	"bitDiameter",
	"safeRadius",
	"plungeFeedrate",
] as const;
type LengthField = (typeof LENGTH_FIELDS)[number];
const isLengthField = (key: string): key is LengthField =>
	(LENGTH_FIELDS as readonly string[]).includes(key);

const round3 = (n: number) => Number(n.toFixed(3));

// mm -> display units
const paramsToDisplay = (
	mm: ScrewSpotParams,
	units: "mm" | "in",
): ScrewSpotParams => {
	if (units === "mm") {
		return { ...mm };
	}
	const out = { ...mm };
	for (const field of LENGTH_FIELDS) {
		out[field] = round3(mm[field] / MM_PER_IN);
	}
	return out;
};

// Apply a display-unit patch back onto the canonical millimetre params.
const patchToMm = (
	patch: Partial<ScrewSpotParams>,
	units: "mm" | "in",
): Partial<ScrewSpotParams> => {
	if (units === "mm") {
		return patch;
	}
	const out: Partial<ScrewSpotParams> = { ...patch };
	for (const key of Object.keys(patch) as (keyof ScrewSpotParams)[]) {
		if (isLengthField(key)) {
			out[key] = Number(patch[key]) * MM_PER_IN;
		}
	}
	return out;
};

const ACCENT = "rgba(14, 246, 174, 0.95)";
const SAFE_RING = "rgba(148, 163, 184, 0.9)";

// Persist the edited params so they carry across panel toggles and gSender
// restarts. The plugin iframe runs same-origin from a stable URL, so its
// localStorage survives sessions; we store the canonical millimetre params (never
// the display-unit view, so switching mm/in can't corrupt them) under a
// namespaced key. Points/spots stay job-specific and are intentionally not saved.
const PARAMS_STORAGE_KEY = "screw-spot:params";

const loadStoredParams = (): ScrewSpotParams => {
	try {
		const raw = localStorage.getItem(PARAMS_STORAGE_KEY);
		if (!raw) {
			return DEFAULT_SCREWSPOT_PARAMS;
		}
		const saved = JSON.parse(raw) as Partial<ScrewSpotParams>;
		// Merge over defaults so a blob saved by an older version (missing newer
		// fields) still fills them, and drop anything of the wrong type so corrupt
		// or hand-edited storage can't produce NaN heights or a bad aux enum.
		const merged: ScrewSpotParams = { ...DEFAULT_SCREWSPOT_PARAMS };
		const numericTarget = merged as unknown as Record<string, number>;
		for (const key of Object.keys(
			DEFAULT_SCREWSPOT_PARAMS,
		) as (keyof ScrewSpotParams)[]) {
			const value = saved[key];
			if (key === "auxOutput") {
				if (value === "none" || value === "mist" || value === "flood") {
					merged.auxOutput = value;
				}
				continue;
			}
			if (typeof value === "number" && Number.isFinite(value)) {
				numericTarget[key] = value;
			}
		}
		return merged;
	} catch {
		return DEFAULT_SCREWSPOT_PARAMS;
	}
};

const saveStoredParams = (params: ScrewSpotParams) => {
	try {
		localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(params));
	} catch {
		// Storage may be unavailable (private mode / opaque origin); persistence is
		// best-effort, so a failure just means params won't carry across sessions.
	}
};

const App = () => {
	const workspace = useWorkspaceState<WorkspaceState>();
	const units: "mm" | "in" = workspace?.units === "in" ? "in" : "mm";

	// Host machine/job state, read reactively from the redux bridge topic.
	const isConnected = useTypedSelector<boolean, ReduxState>(
		(s) => !!s.connection?.isConnected,
	);
	const controllerType = useTypedSelector<string, ReduxState>(
		(s) => s.controller?.type ?? "",
	);
	const activeState = useTypedSelector<string, ReduxState>(
		(s) => s.controller?.state?.status?.activeState ?? "",
	);
	const fileType = useTypedSelector<string | null, ReduxState>(
		(s) => s.file?.fileType ?? null,
	);
	const homingEnabled = useTypedSelector<boolean, ReduxState>(
		(s) => Number(s.controller?.settings?.settings?.$22 ?? 0) !== 0,
	);
	const machineZ = useTypedSelector<number, ReduxState>(
		(s) =>
			Number(
				s.controller?.mpos?.z ??
					s.controller?.state?.status?.mpos?.z ??
					0,
			),
	);

	// Canonical millimetre params; the panel sees/edits them in display units.
	// Hydrated from localStorage (lazy init) so the last-used values are restored.
	const [paramsMm, setParamsMm] = useState<ScrewSpotParams>(loadStoredParams);
	const displayParams = useMemo(
		() => paramsToDisplay(paramsMm, units),
		[paramsMm, units],
	);

	// Persist edits (canonical mm) so they survive panel toggles and app restarts.
	useEffect(() => {
		saveStoredParams(paramsMm);
	}, [paramsMm]);

	const [points, setPoints] = useState<ScrewSpotPoint[]>([]);
	// Activating the plugin (mounting this panel) drops straight into placement
	// mode — there's no separate "Place spots" button. Picking stays armed until
	// the job runs (onRun disarms it).
	const [placing, setPlacing] = useState(true);
	const [status, setStatus] = useState<string | null>(null);

	// --- Picking: append a point per click while "place spots" is active --------
	const handlePick = useCallback((e: Parameters<Parameters<typeof useVisualizerPick>[1]>[0]) => {
		if (e.kind !== "pick") {
			return;
		}
		setPoints((prev) => [...prev, { x: e.world.x, y: e.world.y }]);
	}, []);

	const { armed, error: pickError } = useVisualizerPick("click", handlePick, {
		enabled: placing,
	});

	// Pin the camera to Top and lock rotation while placing so clicks map cleanly
	// onto the XY work plane, then toggle back to the 3D view when placing ends —
	// mirrors Move To Here, which restores the camera when its pick disarms. (The
	// plugin bridge can't read the current camera view, so we round-trip to the
	// default 3D view rather than whatever the user was on before.)
	useEffect(() => {
		if (!placing) {
			return;
		}
		gsender.viewer.camera.set("top").catch(() => {});
		gsender.viewer.camera.lockRotate(true).catch(() => {});
		return () => {
			gsender.viewer.camera.lockRotate(false).catch(() => {});
			gsender.viewer.camera.set("3d").catch(() => {});
		};
	}, [placing]);

	// Push all points to the host overlay as world-coord markers: a slate safe-radius
	// ring plus an accent hole marker carrying the spot number (via `label`).
	useEffect(() => {
		const markers: OverlayMarker[] = [];
		points.forEach((pt, i) => {
			markers.push({
				id: `spot-${i}-ring`,
				x: pt.x,
				y: pt.y,
				shape: "ring",
				color: SAFE_RING,
				size: 18,
			});
			markers.push({
				id: `spot-${i}`,
				x: pt.x,
				y: pt.y,
				shape: "circle",
				color: ACCENT,
				size: 8,
				label: String(i + 1),
			});
		});
		gsender.viewer.setOverlay(markers).catch(() => {});
	}, [points]);

	// Defensive cleanup on unmount (the host does this too when the panel closes):
	// clear markers and disarm any pick we left armed.
	useEffect(() => {
		return () => {
			gsender.viewer.setOverlay([]).catch(() => {});
			gsender.viewer.disarmPick().catch(() => {});
		};
	}, []);

	// --- Readiness gate (connected + idle + non-rotary), mirrors native ----------
	const readiness = useMemo((): { ok: boolean; reason: string } => {
		const isRotary = fileType === "ROTARY" || fileType === "FOUR_AXIS";
		if (!isConnected) {
			return { ok: false, reason: "Connect to a machine first" };
		}
		if (activeState !== GRBL_ACTIVE_STATE_IDLE) {
			return { ok: false, reason: "Machine must be idle" };
		}
		if (isRotary) {
			return { ok: false, reason: "Not available for rotary files" };
		}
		return { ok: true, reason: "" };
	}, [isConnected, activeState, fileType]);

	const heightsIssue = screwSpotHeightsReason(displayParams);
	const hasPoints = points.length > 0;
	const canRun = readiness.ok && hasPoints && !heightsIssue;
	const runDisabledReason = !hasPoints
		? "Click at least one spot on the job"
		: !readiness.ok
			? readiness.reason
			: heightsIssue;

	// Live preview of the generated program's size.
	const lineCount = useMemo(() => {
		if (!hasPoints) {
			return 0;
		}
		const lines = generateScrewSpotGcode({
			points,
			params: displayParams,
			units,
			isGrblHal: controllerType === GRBLHAL,
			returnArray: true,
		}) as string[];
		return lines.length;
	}, [points, displayParams, units, controllerType, hasPoints]);

	const onParamChange = useCallback(
		(patch: Partial<ScrewSpotParams>) => {
			setParamsMm((prev) => ({ ...prev, ...patchToMm(patch, units) }));
		},
		[units],
	);

	const onRemovePoint = useCallback((index: number) => {
		setPoints((prev) => prev.filter((_, i) => i !== index));
	}, []);

	const onClear = useCallback(() => setPoints([]), []);

	// --- Run: generate + inject via the exact native machine command -------------
	const onRun = useCallback(async () => {
		if (points.length === 0) {
			return;
		}
		if (!readiness.ok) {
			setStatus(readiness.reason);
			return;
		}
		if (heightsIssue) {
			setStatus(heightsIssue);
			return;
		}
		const safeRetractHeight = Number(workspace?.safeRetractHeight ?? -1);
		const retractCode = getSafeRetractCode({
			safeRetractHeight,
			homingEnabled: !!homingEnabled,
			currentMachineZ: machineZ ?? 0,
		});
		const gcode = generateScrewSpotGcode({
			points,
			params: displayParams,
			units,
			retractCode,
			returnArray: true,
			isGrblHal: controllerType === GRBLHAL,
		}) as string[];
		try {
			// Flag the machine busy for the whole batch before streaming it. We run
			// through the feeder (machine.command "gcode") so the loaded job is left
			// untouched, but that makes the controller's activeState flicker Idle
			// between moves — this latch holds a stable "running" status in the host.
			// The host owns release (auto-clears once the machine truly goes idle,
			// and via its own safety nets), so we only raise it here — and clear it
			// on the catch below if the stream never actually starts.
			console.log("[busy] plugin: calling setBusy(true)…");
			await gsender.machine.setBusy(true, "Screw Spot").then(
				() => console.log("[busy] plugin: setBusy(true) resolved OK"),
				(e) => console.warn("[busy] plugin: setBusy(true) REJECTED", e),
			);
			// Native ran: controller.command("gcode", gcode, controller.context).
			// The SDK mirror: machine.command("gcode", <lines>, <context>).
			const ctx = await gsender.machine.getContext();
			await gsender.machine.command("gcode", gcode, ctx);
			setStatus(
				`Spot drilling ${points.length} point${points.length === 1 ? "" : "s"}`,
			);
			setPlacing(false);
		} catch (err) {
			// The command never dispatched — release the busy latch now rather than
			// leaving the host to time it out on its no-motion grace.
			await gsender.machine.setBusy(false).catch(() => {});
			setStatus(err instanceof Error ? err.message : String(err));
		}
	}, [
		points,
		readiness,
		heightsIssue,
		workspace,
		homingEnabled,
		machineZ,
		displayParams,
		units,
		controllerType,
	]);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<ScrewSpotPanel
				params={displayParams}
				points={points}
				units={units}
				placing={placing}
				armed={armed}
				pickError={pickError}
				lineCount={lineCount}
				canRun={canRun}
				runDisabledReason={runDisabledReason}
				onParamChange={onParamChange}
				onRemovePoint={onRemovePoint}
				onClear={onClear}
				onRun={onRun}
			/>
			{status && (
				<p className="px-1 pb-1 text-xs text-gray-500 dark:text-gray-400">
					{status}
				</p>
			)}
		</div>
	);
};

export default App;

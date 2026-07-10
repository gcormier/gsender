import { gsender } from "@sienci/gsender-plugin-sdk";
import {
	useTypedSelector,
	useVisualizerPick,
} from "@sienci/gsender-plugin-sdk/react";
import { useCallback, useRef, useState } from "react";

import {
	getSafeXYMoveCode,
	machineIsReadyToMove,
	type ReduxSnapshot,
	roundCoord,
	unitModalFor,
	type WorkspaceSnapshot,
} from "./safeMove";

type Coords = { x: number; y: number };

// Progress ring geometry (mirrors the native press-and-hold indicator).
const RING_SIZE = 72;
const RING_STROKE = 6;
const RING_RADIUS = RING_SIZE / 2 - RING_STROKE;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

const ProgressRing = ({ t }: { t: number }) => (
	<svg
		width={RING_SIZE}
		height={RING_SIZE}
		viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
		className="shrink-0"
		aria-hidden="true"
	>
		<circle
			cx={RING_SIZE / 2}
			cy={RING_SIZE / 2}
			r={RING_RADIUS}
			fill="none"
			stroke="currentColor"
			strokeOpacity={0.15}
			strokeWidth={RING_STROKE}
		/>
		<circle
			cx={RING_SIZE / 2}
			cy={RING_SIZE / 2}
			r={RING_RADIUS}
			fill="none"
			stroke="#22c55e"
			strokeWidth={RING_STROKE}
			strokeLinecap="round"
			strokeDasharray={RING_CIRC}
			strokeDashoffset={RING_CIRC * (1 - Math.max(0, Math.min(1, t)))}
			transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
			style={{ transition: "stroke-dashoffset 60ms linear" }}
		/>
	</svg>
);

const App = () => {
	// Live idle gate — drives whether we (re-)arm and what status we show. The
	// host also refuses to arm unless connected + idle; mirroring the check here
	// lets us surface *why* and re-arm automatically when the machine settles.
	const isConnected =
		useTypedSelector<boolean, ReduxSnapshot>(
			(s) => !!s?.connection?.isConnected,
		) ?? false;
	const activeState = useTypedSelector<string | undefined, ReduxSnapshot>(
		(s) => s?.controller?.state?.status?.activeState,
	);
	const eligible = isConnected && activeState === "Idle";

	const [progress, setProgress] = useState(0);
	const [lastPick, setLastPick] = useState<Coords | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [sending, setSending] = useState(false);

	// One move at a time — guard against a second pick landing mid-dispatch.
	const busyRef = useRef(false);

	const handlePick = useCallback(
		async (
			event: Parameters<Parameters<typeof useVisualizerPick>[1]>[0],
		) => {
			if (event.kind === "hold-progress") {
				setProgress(event.t);
				return;
			}

			// kind === "pick"
			setProgress(0);
			if (busyRef.current) {
				return;
			}
			busyRef.current = true;
			setSending(true);
			setMessage(null);

			try {
				// Re-read live state and self-gate on Idle right before moving,
				// exactly like the native commit path.
				const redux = (await gsender.redux.getState()) as ReduxSnapshot;
				if (!machineIsReadyToMove(redux)) {
					setMessage("Machine must be connected and idle to move.");
					return;
				}

				const workspace =
					(await gsender.workspace.getState()) as WorkspaceSnapshot;

				const x = roundCoord(event.world.x);
				const y = roundCoord(event.world.y);
				const lines = getSafeXYMoveCode(x, y, redux, workspace);
				const unitModal = unitModalFor(workspace?.units);

				// Drop a transient target marker while the move is dispatched.
				await gsender.viewer.setOverlay([
					{
						id: "move-to-here-target",
						x,
						y,
						shape: "ring",
						color: "#22c55e",
						size: 10,
						label: `X${x.toFixed(2)} Y${y.toFixed(2)}`,
					},
				]);

				// Same command the native feature issued:
				//   controller.command("gcode:safe", getSafeXYMoveCode(x, y), unitModal)
				await gsender.machine.command("gcode:safe", lines, unitModal);

				setLastPick({ x, y });
				setMessage(`Moving to X${x.toFixed(2)} Y${y.toFixed(2)}.`);
			} catch (err) {
				setMessage(err instanceof Error ? err.message : String(err));
			} finally {
				// Clear the transient marker once the command has been sent.
				await gsender.viewer.setOverlay([]).catch(() => {});
				busyRef.current = false;
				setSending(false);
			}
		},
		[],
	);

	// Arm a press-and-hold pick whenever the machine is eligible. The host pins
	// the camera to Top and locks orbit on arm, so we don't touch the camera.
	// Flipping `enabled` with `eligible` gives us automatic re-arming when the
	// machine returns to Idle after a move.
	const { armed, error } = useVisualizerPick("hold", handlePick, {
		enabled: eligible,
	});

	let statusTone: "ok" | "warn" | "info" = "info";
	let statusText: string;
	if (!isConnected) {
		statusTone = "warn";
		statusText = "Connect a machine to use Move To Here.";
	} else if (activeState !== "Idle") {
		statusTone = "warn";
		statusText = `Machine must be idle to arm (currently ${
			activeState ?? "unknown"
		}).`;
	} else if (error) {
		statusTone = "warn";
		statusText = error;
	} else if (armed) {
		statusTone = "ok";
		statusText = "Armed — press and hold on the job to move here.";
	} else {
		statusTone = "info";
		statusText = "Arming…";
	}

	const toneClass =
		statusTone === "ok"
			? "text-green-600 dark:text-green-400"
			: statusTone === "warn"
				? "text-amber-600 dark:text-amber-400"
				: "text-gray-500 dark:text-gray-400";

	const dotClass =
		statusTone === "ok"
			? "bg-green-500"
			: statusTone === "warn"
				? "bg-amber-500"
				: "bg-gray-400";

	return (
		<div className="flex h-full flex-col gap-4 p-3 text-gray-900 dark:text-gray-100">
			<div>
				<h1 className="m-0 text-base font-semibold">Move To Here</h1>
				<p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
					Press and hold a point on the job to rapid there (Z retracts to your
					safe height first).
				</p>
			</div>

			<div className="flex items-center gap-2 text-sm">
				<span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
				<span className={toneClass}>{statusText}</span>
			</div>

			<div className="flex flex-1 flex-col items-center justify-center gap-3">
				<div className="text-gray-700 dark:text-gray-200">
					<ProgressRing t={progress} />
				</div>
				<div className="text-xs text-gray-500 dark:text-gray-400">
					{sending
						? "Sending move…"
						: progress > 0
							? "Keep holding…"
							: "Hold ring fills as you press"}
				</div>
			</div>

			<div className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
				<div className="text-xs font-semibold text-gray-500 uppercase dark:text-gray-400">
					Last target
				</div>
				{lastPick ? (
					<div className="mt-1 font-mono">
						X{lastPick.x.toFixed(3)} Y{lastPick.y.toFixed(3)}
					</div>
				) : (
					<div className="mt-1 text-gray-400">No move yet</div>
				)}
			</div>

			{message && (
				<p className="m-0 text-xs text-gray-500 dark:text-gray-400">{message}</p>
			)}
		</div>
	);
};

export default App;

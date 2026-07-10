import { GRBL_ACTIVE_STATE_IDLE, VISUALIZER_PRIMARY } from "app/constants";
import type { VisualizerBridgeHandle } from "app/features/Visualizer/visualizerBridge";
import { visualizerBridge } from "app/features/Visualizer/visualizerBridge";
import controller from "app/lib/controller";
import { uploadGcodeFileToServer } from "app/lib/fileupload";
import store from "app/store";
import reduxStore from "app/store/redux";
import type {
	OverlayMarker,
	PLUGIN_BRIDGE_CHANNEL,
	PluginBridgeRequest,
	PluginBridgeResponse,
	PluginBridgeSubscribe,
	PluginBridgeTopic,
} from "../types";

const BRIDGE_CHANNEL: typeof PLUGIN_BRIDGE_CHANNEL = "gsender:plugin-bridge";

const getWorkspaceSnapshot = () => store.get("workspace", {});

const getReduxSnapshot = () => reduxStore.getState();

const getTopicSnapshot = (topic: PluginBridgeTopic): unknown => {
	switch (topic) {
		case "workspace":
			return getWorkspaceSnapshot();
		case "redux":
			return getReduxSnapshot();
		// "viewer" is a push-only event stream (pick/hold-progress); there is no
		// meaningful initial snapshot, so subscribers get null until an event fires.
		case "viewer":
			return null;
		default:
			return null;
	}
};

const requireVisualizer = (): VisualizerBridgeHandle => {
	const handle = visualizerBridge.get();
	if (!handle) {
		throw new Error("Visualizer is not available");
	}
	return handle;
};

// Defense-in-depth idle gate mirroring the app's `activeState === 'Idle'` checks:
// picking drives real machine moves, so refuse unless connected and idle.
const machineIsConnectedAndIdle = (): boolean => {
	const state = reduxStore.getState();
	const isConnected = !!state.connection?.isConnected;
	const activeState = state.controller?.state?.status?.activeState;
	return isConnected && activeState === GRBL_ACTIVE_STATE_IDLE;
};

const getMachineContext = () => {
	const units = store.get("workspace.units", "mm");
	const machineProfile = store.get("workspace.machineProfile", {});
	const controllerState = reduxStore.getState().controller;
	const connectionState = reduxStore.getState().connection;

	return {
		units,
		machineProfile,
		connected: connectionState.isConnected,
		port: controller.port,
		position: controllerState?.state?.status?.mpos || null,
		workPosition: controllerState?.state?.status?.wpos || null,
	};
};

const runMachineCommand = async (payload: Record<string, unknown> = {}) => {
	const cmd = String(payload.cmd || "");
	const args = Array.isArray(payload.args) ? payload.args : [];

	if (!cmd) {
		throw new Error("cmd is required");
	}

	return new Promise((resolve, reject) => {
		controller.command(cmd, ...args, (err: Error | null, data: unknown) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(data);
		});
	});
};

const loadGCodeToVisualizer = async ({
	gcode,
	name,
}: {
	gcode: string;
	name: string;
}) => {
	const file = new File([gcode], name);
	await uploadGcodeFileToServer(file, controller.port, VISUALIZER_PRIMARY);
	// The upload helper resolves with a raw axios response (functions, headers,
	// etc.) which can't be structured-cloned back across postMessage. Return a
	// plain, serializable ack instead.
	return { ok: true, name };
};

const handleBridgeRequest = async (
	request: PluginBridgeRequest,
): Promise<unknown> => {
	switch (request.type) {
		case "machine:get:context":
			return getMachineContext();
		case "machine:command":
			return runMachineCommand(request.payload);
		case "workspace:get:state":
			return getWorkspaceSnapshot();
		case "redux:get:state":
			return getReduxSnapshot();
		case "gcode:load:to:visualizer":
			return loadGCodeToVisualizer(
				request.payload as { gcode: string; name: string },
			);
		case "viewer:screen-to-world": {
			const handle = requireVisualizer();
			const { px, py } = (request.payload ?? {}) as { px: number; py: number };
			return handle.screenToWorld(px, py);
		}
		case "viewer:world-to-screen": {
			const handle = requireVisualizer();
			const { x, y, z } = (request.payload ?? {}) as {
				x: number;
				y: number;
				z?: number;
			};
			return handle.worldToScreen(x, y, z);
		}
		case "viewer:camera:set": {
			const handle = requireVisualizer();
			const { view } = (request.payload ?? {}) as {
				view: "top" | "3d" | "front" | "left" | "right";
			};
			handle.setCameraView(view);
			return { ok: true };
		}
		case "viewer:camera:lock-rotate": {
			const handle = requireVisualizer();
			const { locked } = (request.payload ?? {}) as { locked: boolean };
			handle.setRotateEnabled(!locked);
			return { ok: true };
		}
		case "viewer:pick:arm": {
			const handle = requireVisualizer();
			if (handle.isRotaryFile()) {
				throw new Error("Picking is not available for rotary files");
			}
			if (!machineIsConnectedAndIdle()) {
				throw new Error("Machine must be connected and idle to pick a point");
			}
			const { mode } = (request.payload ?? {}) as {
				mode?: "click" | "hold";
			};
			handle.armPick(
				mode === "click" ? "click" : "hold",
				(p) =>
					broadcastViewerEvent({
						kind: "pick",
						world: p.world,
						screen: p.screen,
					}),
				(t) => broadcastViewerEvent({ kind: "hold-progress", t }),
			);
			return { ok: true };
		}
		case "viewer:pick:disarm": {
			const handle = requireVisualizer();
			handle.disarmPick();
			return { ok: true };
		}
		case "viewer:overlay:set": {
			const handle = requireVisualizer();
			const { markers } = (request.payload ?? {}) as {
				markers?: OverlayMarker[];
			};
			handle.setOverlay(Array.isArray(markers) ? markers : []);
			return { ok: true };
		}
		default:
			throw new Error(`Unknown bridge request: ${request.type}`);
	}
};

export const handlePluginBridgeMessage = async (
	event: MessageEvent,
): Promise<PluginBridgeResponse | null> => {
	if (event.data?.channel !== BRIDGE_CHANNEL || !event.data?.request) {
		return null;
	}

	const request = event.data.request as PluginBridgeRequest;

	try {
		const result = await handleBridgeRequest(request);
		return {
			id: request.id,
			ok: true,
			result,
		};
	} catch (err) {
		return {
			id: request.id,
			ok: false,
			error: err instanceof Error ? err.message : "Bridge request failed",
		};
	}
};

// --- Reactive subscriptions ---------------------------------------------------
// Plugins subscribe to a topic; the host pushes a fresh snapshot whenever the
// underlying store changes. A single host-level listener per source fans out to
// every active plugin subscription so we never attach/detach store listeners per
// subscriber.

type PluginSubscription = {
	id: string;
	topic: PluginBridgeTopic;
	source: MessageEventSource;
	origin: string;
};

const subscriptions = new Map<string, PluginSubscription>();
let hostListenersInstalled = false;

const pushUpdate = (sub: PluginSubscription, snapshot: unknown) => {
	try {
		sub.source.postMessage(
			{
				channel: BRIDGE_CHANNEL,
				update: { id: sub.id, topic: sub.topic, snapshot },
			},
			{ targetOrigin: sub.origin },
		);
	} catch {
		// The iframe is gone (navigated/unmounted) — drop the dead subscription.
		subscriptions.delete(sub.id);
	}
};

const broadcast = (topic: PluginBridgeTopic) => {
	if (subscriptions.size === 0) {
		return;
	}

	// Compute the snapshot once per broadcast, shared across subscribers.
	let snapshot: unknown;
	let computed = false;

	subscriptions.forEach((sub) => {
		if (sub.topic !== topic) {
			return;
		}
		if (!computed) {
			snapshot = getTopicSnapshot(topic);
			computed = true;
		}
		pushUpdate(sub, snapshot);
	});
};

// Push a one-off event (pick / hold-progress) to every "viewer"-topic
// subscriber. Unlike broadcast(), the payload is the event itself rather than a
// recomputed state snapshot, since "viewer" is a push-only event stream.
const broadcastViewerEvent = (event: unknown) => {
	if (subscriptions.size === 0) {
		return;
	}
	subscriptions.forEach((sub) => {
		if (sub.topic !== "viewer") {
			return;
		}
		pushUpdate(sub, event);
	});
};

const ensureHostListeners = () => {
	if (hostListenersInstalled) {
		return;
	}
	hostListenersInstalled = true;

	store.on("change", () => broadcast("workspace"));
	// NOTE: redux subscribe fires on every action; the snapshot is only computed
	// when there is at least one active redux subscriber.
	reduxStore.subscribe(() => broadcast("redux"));
};

const addSubscription = (
	source: MessageEventSource,
	origin: string,
	subscribe: PluginBridgeSubscribe,
) => {
	ensureHostListeners();

	const sub: PluginSubscription = {
		id: subscribe.id,
		topic: subscribe.topic,
		source,
		origin,
	};

	subscriptions.set(sub.id, sub);

	// Push the current value immediately so the hook renders without waiting for
	// the next store change.
	pushUpdate(sub, getTopicSnapshot(sub.topic));
};

const removeSubscription = (id: string) => {
	subscriptions.delete(id);
};

export const installPluginBridgeListener = () => {
	const listener = async (event: MessageEvent) => {
		const data = event.data;

		if (!data || data.channel !== BRIDGE_CHANNEL) {
			return;
		}

		if (data.subscribe && event.source) {
			addSubscription(
				event.source,
				event.origin,
				data.subscribe as PluginBridgeSubscribe,
			);
			return;
		}

		if (data.unsubscribe) {
			removeSubscription(data.unsubscribe.id);
			return;
		}

		if (!data.request) {
			return;
		}

		const response = await handlePluginBridgeMessage(event);

		if (
			!response ||
			!event.source ||
			typeof event.source.postMessage !== "function"
		) {
			return;
		}

		event.source.postMessage(
			{
				channel: BRIDGE_CHANNEL,
				response,
			},
			{ targetOrigin: event.origin },
		);
	};

	window.addEventListener("message", listener);

	return () => {
		window.removeEventListener("message", listener);
	};
};

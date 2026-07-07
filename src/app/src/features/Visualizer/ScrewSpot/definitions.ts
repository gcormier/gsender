// Screw Spot: pick safe XY locations on the loaded job's top view and spot-drill
// them so the user can drive hold-down screws there. Types + params shared by the
// panel, the picking/overlay in GcodeViewer, and the pure g-code generator.

export interface ScrewSpotPoint {
	x: number;
	y: number;
}

// What the current Z work zero represents. Screw spots sit in exposed areas, so we
// only need stock thickness to reach the spoilboard when Z0 is the top of the stock.
export type ZReference = "stockTop" | "spoilboard";

export type AuxOutput = "none" | "mist" | "flood";

export interface ScrewSpotParams {
	zReference: ZReference;
	spotDepth: number; // how far into the spoilboard to drill (below its surface)
	stockThickness: number; // only used when zReference === "stockTop"
	bitDiameter: number; // preview only — sizes the hole circle
	safeRadius: number; // preview only — sizes the safe screw-head ring
	spindleRPM: number;
	spindleDwell: number; // seconds held after M3 so the spindle reaches speed
	plungeFeedrate: number;
	retractHeight: number; // clearance above the top surface (Z0) for rapids
	auxOutput: AuxOutput; // M7/M8 at start + M9 at end, e.g. dust collection
}

// Values are stored in millimetres (the panel converts for imperial display, like
// Surfacing does).
export const DEFAULT_SCREWSPOT_PARAMS: ScrewSpotParams = {
	zReference: "stockTop",
	spotDepth: 3,
	stockThickness: 12,
	bitDiameter: 6.35,
	safeRadius: 10,
	spindleRPM: 10000,
	spindleDwell: 2,
	plungeFeedrate: 100,
	retractHeight: 5,
	auxOutput: "none",
};

// Absolute work-Z the tool plunges to. Z0 is always the top reference: when it is the
// stock top, drop through the stock (thickness) plus the spot depth into the spoilboard;
// when it is the spoilboard surface, just the spot depth below it.
export function computeTargetZ(
	p: Pick<ScrewSpotParams, "zReference" | "stockThickness" | "spotDepth">,
): number {
	const spoilboardZ = p.zReference === "stockTop" ? -Math.abs(p.stockThickness) : 0;
	return Number((spoilboardZ - Math.abs(p.spotDepth)).toFixed(3));
}

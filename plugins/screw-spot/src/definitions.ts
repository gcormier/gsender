// Screw Spot: pick safe XY locations on the loaded job's top view and spot-drill
// them so the user can drive hold-down screws there. Types + params shared by the
// panel, the picking/overlay in App, and the pure g-code generator.

export interface ScrewSpotPoint {
	x: number;
	y: number;
}

export type AuxOutput = "none" | "mist" | "flood";

// Every hole is three plain work-Z heights — no stock/spoilboard reference. Where Z0
// sits is the user's call; they enter the heights they want directly. Each hole moves
// XY at travelZ, rapids down to plungeZ, feeds to drillZ, then rapids back to travelZ.
export interface ScrewSpotParams {
	travelHeight: number; // Z for all X/Y moves between holes
	plungeHeight: number; // Z we rapid (G0) down to before cutting
	drillDepth: number; // Z we cut (G1) down to
	peckDepth: number; // chip-break peck increment; 0 drills in a single plunge
	bitDiameter: number; // preview only — sizes the hole circle
	safeRadius: number; // preview only — sizes the safe screw-head ring
	spindleRPM: number;
	spindleDwell: number; // seconds held after M3 so the spindle reaches speed
	plungeFeedrate: number;
	auxOutput: AuxOutput; // M7/M8 at start + M9 at end, e.g. dust collection
}

// The heights must descend travel > plunge > drill or the motion is nonsense (no XY
// clearance, or nothing to cut) — and grblHAL's G73 errors outright when R sits below
// Z. Returns a human reason when the order is wrong, or "" when it's fine. Works at any
// Z zero since it only compares the three values to each other.
export function screwSpotHeightsReason(
	p: Pick<ScrewSpotParams, "travelHeight" | "plungeHeight" | "drillDepth">,
): string {
	if (p.travelHeight <= p.plungeHeight) {
		return "Travel height must be above plunge height";
	}
	if (p.plungeHeight <= p.drillDepth) {
		return "Plunge height must be above drill depth";
	}
	return "";
}

// Values are stored in millimetres (the panel converts for imperial display, like
// Surfacing does).
export const DEFAULT_SCREWSPOT_PARAMS: ScrewSpotParams = {
	travelHeight: 15,
	plungeHeight: 3,
	drillDepth: -5,
	peckDepth: 2,
	bitDiameter: 6.35,
	safeRadius: 10,
	spindleRPM: 10000,
	spindleDwell: 2,
	plungeFeedrate: 100,
	auxOutput: "none",
};

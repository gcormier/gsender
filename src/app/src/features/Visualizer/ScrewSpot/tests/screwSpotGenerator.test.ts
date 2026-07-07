import {
	DEFAULT_SCREWSPOT_PARAMS,
	screwSpotHeightsReason,
} from "../definitions";
import {
	generateScrewSpotGcode,
	orderPointsNearestNeighbour,
} from "../screwSpotGcodeGenerator";

describe("Screw Spot height ordering guard", () => {
	it("accepts descending travel > plunge > drill heights", () => {
		expect(
			screwSpotHeightsReason({ travelHeight: 15, plungeHeight: 3, drillDepth: -5 }),
		).toBe("");
	});

	it("holds regardless of where Z zero sits (all negative)", () => {
		expect(
			screwSpotHeightsReason({ travelHeight: -1, plungeHeight: -3, drillDepth: -8 }),
		).toBe("");
	});

	it("flags travel not above plunge", () => {
		expect(
			screwSpotHeightsReason({ travelHeight: 3, plungeHeight: 3, drillDepth: -5 }),
		).toMatch(/travel height/i);
	});

	it("flags plunge not above drill", () => {
		expect(
			screwSpotHeightsReason({ travelHeight: 15, plungeHeight: -5, drillDepth: -5 }),
		).toMatch(/plunge height/i);
	});
});

describe("Screw Spot point ordering", () => {
	it("orders points greedily from the work origin", () => {
		const ordered = orderPointsNearestNeighbour([
			{ x: 100, y: 0 },
			{ x: 10, y: 0 },
			{ x: 50, y: 0 },
		]);
		expect(ordered).toEqual([
			{ x: 10, y: 0 },
			{ x: 50, y: 0 },
			{ x: 100, y: 0 },
		]);
	});
});

describe("Screw Spot g-code generation", () => {
	const points = [
		{ x: 10, y: 20 },
		{ x: 30, y: 40 },
	];

	it("emits metric units and spindle on/off by default", () => {
		const gcode = generateScrewSpotGcode({
			points,
			params: DEFAULT_SCREWSPOT_PARAMS,
			units: "mm",
		}) as string;
		expect(gcode).toMatch(/G21/);
		expect(gcode).toMatch(/M3 S10000/);
		expect(gcode).toMatch(/M5/);
	});

	it("emits imperial units when requested", () => {
		const gcode = generateScrewSpotGcode({
			points,
			params: DEFAULT_SCREWSPOT_PARAMS,
			units: "in",
		}) as string;
		expect(gcode).toMatch(/G20/);
	});

	it("cuts every point to the drill depth in a single feed when peck is off", () => {
		const gcode = generateScrewSpotGcode({
			points,
			params: {
				...DEFAULT_SCREWSPOT_PARAMS,
				drillDepth: -5,
				peckDepth: 0,
				plungeFeedrate: 100,
			},
			units: "mm",
			returnArray: true,
		}) as string[];
		const cuts = gcode.filter((line) => line.startsWith("G1 Z"));
		expect(cuts).toHaveLength(2);
		cuts.forEach((line) => expect(line).toBe("G1 Z-5 F100 ;Drill depth"));
	});

	it("moves XY at the travel height and rapids down to the plunge height", () => {
		const gcode = generateScrewSpotGcode({
			points,
			params: { ...DEFAULT_SCREWSPOT_PARAMS, travelHeight: 15, plungeHeight: 3 },
			units: "mm",
			returnArray: true,
		}) as string[];
		expect(gcode).toEqual(
			expect.arrayContaining([
				"G0 Z15 ;Travel height",
				"G0 Z3 ;Plunge height",
				"G0 Z15 ;Rapid out to travel height",
			]),
		);
	});

	it("hand-expands a chip-break peck on Grbl (no G73)", () => {
		const gcode = generateScrewSpotGcode({
			points: [{ x: 10, y: 20 }],
			params: {
				...DEFAULT_SCREWSPOT_PARAMS,
				plungeHeight: 3,
				drillDepth: -5,
				peckDepth: 2,
				plungeFeedrate: 100,
			},
			units: "mm",
			returnArray: true,
		}) as string[];
		// Steps down 3 → 1 → -1 → -3 → -5 (clamped), snapping the chip between pecks.
		expect(gcode.filter((l) => l.startsWith("G1 Z"))).toEqual([
			"G1 Z1 F100",
			"G1 Z-1 F100",
			"G1 Z-3 F100",
			"G1 Z-5 F100",
		]);
		expect(gcode).toEqual(expect.arrayContaining(["G0 Z1.1 ;Chip break"]));
		expect(gcode).not.toEqual(expect.arrayContaining([expect.stringContaining("G73")]));
	});

	it("emits a sticky G73 canned cycle on grblHAL", () => {
		const gcode = generateScrewSpotGcode({
			points,
			params: {
				...DEFAULT_SCREWSPOT_PARAMS,
				travelHeight: 15,
				plungeHeight: 3,
				drillDepth: -5,
				peckDepth: 2,
				plungeFeedrate: 100,
			},
			units: "mm",
			returnArray: true,
			isGrblHal: true,
		}) as string[];
		expect(gcode).toEqual(
			expect.arrayContaining([
				"G0 Z15 ;Travel height (G98 initial plane)",
				"G98 G90 G73 X10 Y20 Z-5 R3 Q2 F100 ;Spot 1",
				"X30 Y40 ;Spot 2",
				"G80 ;Cancel canned cycle",
			]),
		);
		// Sticky: only the first hole carries the cycle words.
		expect(gcode.filter((l) => l.startsWith("G98 G90 G73"))).toHaveLength(1);
	});

	it("wraps aux output with M8/M9 when flood is selected", () => {
		const gcode = generateScrewSpotGcode({
			points,
			params: { ...DEFAULT_SCREWSPOT_PARAMS, auxOutput: "flood" },
			units: "mm",
			returnArray: true,
		}) as string[];
		expect(gcode).toEqual(expect.arrayContaining(["M8 ;Aux output on"]));
		expect(gcode).toEqual(expect.arrayContaining(["M9 ;Aux output off"]));
	});

	it("prepends the homing-aware retract code and re-asserts G90", () => {
		const gcode = generateScrewSpotGcode({
			points,
			params: DEFAULT_SCREWSPOT_PARAMS,
			units: "mm",
			retractCode: ["G53 G0 Z-1"],
			returnArray: true,
		}) as string[];
		expect(gcode).toEqual(expect.arrayContaining(["G53 G0 Z-1"]));
	});
});

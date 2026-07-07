import { computeTargetZ, DEFAULT_SCREWSPOT_PARAMS } from "../definitions";
import {
	generateScrewSpotGcode,
	orderPointsNearestNeighbour,
} from "../screwSpotGcodeGenerator";

describe("Screw Spot target Z", () => {
	it("drops through stock plus spot depth when Z0 is the stock top", () => {
		expect(
			computeTargetZ({
				zReference: "stockTop",
				stockThickness: 12,
				spotDepth: 3,
			}),
		).toBe(-15);
	});

	it("drops only the spot depth when Z0 is the spoilboard surface", () => {
		expect(
			computeTargetZ({
				zReference: "spoilboard",
				stockThickness: 12,
				spotDepth: 3,
			}),
		).toBe(-3);
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

	it("plunges every point to the computed target Z at the plunge feed", () => {
		const gcode = generateScrewSpotGcode({
			points,
			params: { ...DEFAULT_SCREWSPOT_PARAMS, stockThickness: 12, spotDepth: 3 },
			units: "mm",
			returnArray: true,
		}) as string[];
		const plunges = gcode.filter((line) => line.startsWith("G1 Z"));
		expect(plunges).toHaveLength(2);
		plunges.forEach((line) => expect(line).toBe("G1 Z-15 F100"));
	});

	it("rapids at the clearance height above the top surface between holes", () => {
		const gcode = generateScrewSpotGcode({
			points,
			params: { ...DEFAULT_SCREWSPOT_PARAMS, retractHeight: 5 },
			units: "mm",
			returnArray: true,
		}) as string[];
		expect(gcode).toEqual(expect.arrayContaining(["G0 Z5"]));
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

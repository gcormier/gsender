import {
	type AuxOutput,
	type ScrewSpotParams,
	type ScrewSpotPoint,
	screwSpotHeightsReason,
} from "./definitions";

// Ported from the fork's src/app/src/features/Visualizer/ScrewSpot/ScrewSpotPanel.tsx.
// The native panel imported gSender host components (Button, ControlledInput, Tooltip,
// lucide icons, classnames); a plugin can't reach `app/*`, so those are re-expressed as
// self-contained Tailwind here. The UX — heights/preview/spindle sections, the
// heights-descending validation, the aux-output segmented control, and the
// points-count + Clear/Run footer — is preserved. Points are managed in this panel
// (delete individual / clear all) since the SDK overlay markers aren't click-to-remove
// the way the native canvas markers were.

interface ScrewSpotPanelProps {
	params: ScrewSpotParams;
	points: ScrewSpotPoint[];
	units: "mm" | "in";
	placing: boolean;
	armed: boolean;
	pickError: string | null;
	lineCount: number;
	canRun: boolean;
	runDisabledReason: string;
	onParamChange: (patch: Partial<ScrewSpotParams>) => void;
	onTogglePlacing: () => void;
	onRemovePoint: (index: number) => void;
	onClear: () => void;
	onRun: () => void;
}

const cx = (...parts: Array<string | false | null | undefined>) =>
	parts.filter(Boolean).join(" ");

// Small segmented control — mirrors the two/three-way pickers used elsewhere without
// pulling in a Select for a couple of fixed options.
function Segmented<T extends string>({
	value,
	options,
	onChange,
}: {
	value: T;
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
}) {
	return (
		<div className="inline-flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-600">
			{options.map((opt) => (
				<button
					key={opt.value}
					type="button"
					onClick={() => onChange(opt.value)}
					className={cx(
						"px-3 py-1 text-sm transition-colors",
						value === opt.value
							? "bg-blue-500 text-white"
							: "bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800",
					)}
				>
					{opt.label}
				</button>
			))}
		</div>
	);
}

function Field({
	label,
	suffix,
	value,
	onChange,
	min,
}: {
	label: string;
	suffix: string;
	value: number;
	onChange: (value: number) => void;
	min?: number;
}) {
	// Lay the unit out as a flex sibling of a borderless input rather than an absolute
	// suffix overlay: the unit reserves its own width, so the right-aligned value can
	// never slide underneath it no matter how wide either is. The input box flex-grows
	// to claim the empty horizontal space between it and the label, so long values with
	// long units (e.g. "1000 mm/min") stay fully visible without widening the panel.
	return (
		<label className="flex items-center justify-between gap-3">
			<span className="shrink-0 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
				{label}
			</span>
			<div className="flex h-9 min-w-0 max-w-[10rem] flex-1 items-center gap-1 rounded-md border border-gray-300 bg-white pr-2 dark:border-gray-600 dark:bg-gray-900">
				<input
					type="number"
					min={min}
					value={value}
					className="h-full w-full min-w-0 flex-1 border-none bg-transparent px-2 py-0 text-right text-blue-600 outline-none dark:text-white"
					onChange={(e) => onChange(Number(e.target.value))}
				/>
				<span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
					{suffix}
				</span>
			</div>
		</label>
	);
}

const sectionLabel = "text-xs font-medium uppercase text-gray-400";

export function ScrewSpotPanel({
	params,
	points,
	units,
	placing,
	armed,
	pickError,
	lineCount,
	canRun,
	runDisabledReason,
	onParamChange,
	onTogglePlacing,
	onRemovePoint,
	onClear,
	onRun,
}: ScrewSpotPanelProps) {
	const feedSuffix = `${units}/min`;
	const heightsIssue = screwSpotHeightsReason(params);

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col text-gray-900 dark:text-gray-100">
			<div className="border-b border-gray-200 px-1 pb-2 dark:border-gray-700">
				<span className="text-xs text-gray-500 dark:text-gray-400">
					Click safe spots on the job, then run.
				</span>
			</div>

			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-3">
				{/* Place-spots mode toggle: arms/disarms the host click pick. */}
				<div className="space-y-1">
					<button
						type="button"
						onClick={onTogglePlacing}
						className={cx(
							"w-full rounded-md border px-3 py-2 text-sm font-medium transition-colors",
							placing
								? "border-[rgba(14,246,174,0.95)] bg-[rgba(14,246,174,0.12)] text-[rgb(6,150,105)] dark:text-[rgba(14,246,174,0.95)]"
								: "border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800",
						)}
					>
						{placing
							? armed
								? "Placing — click the job to add spots"
								: "Arming…"
							: "Place spots"}
					</button>
					{placing && pickError && (
						<p className="text-xs text-red-600 dark:text-red-400">
							Can’t pick: {pickError}
						</p>
					)}
				</div>

				<div className="space-y-2">
					<span className={sectionLabel}>Heights</span>
					<Field
						label="Travel height"
						suffix={units}
						value={params.travelHeight}
						onChange={(travelHeight) => onParamChange({ travelHeight })}
					/>
					<Field
						label="Plunge height"
						suffix={units}
						value={params.plungeHeight}
						onChange={(plungeHeight) => onParamChange({ plungeHeight })}
					/>
					<Field
						label="Drill depth"
						suffix={units}
						value={params.drillDepth}
						onChange={(drillDepth) => onParamChange({ drillDepth })}
					/>
					<Field
						label="Peck depth"
						suffix={units}
						min={0}
						value={params.peckDepth}
						onChange={(peckDepth) => onParamChange({ peckDepth })}
					/>
					{heightsIssue && (
						<p className="text-xs text-amber-600 dark:text-amber-500">
							{heightsIssue} — heights must descend travel &gt; plunge &gt; drill.
						</p>
					)}
				</div>

				<div className="space-y-2">
					<span className={sectionLabel}>Preview</span>
					<Field
						label="Bit diameter"
						suffix={units}
						min={0}
						value={params.bitDiameter}
						onChange={(bitDiameter) => onParamChange({ bitDiameter })}
					/>
					<Field
						label="Safe radius"
						suffix={units}
						min={0}
						value={params.safeRadius}
						onChange={(safeRadius) => onParamChange({ safeRadius })}
					/>
				</div>

				<div className="space-y-2">
					<span className={sectionLabel}>Spindle &amp; motion</span>
					<Field
						label="Spindle RPM"
						suffix="rpm"
						min={0}
						value={params.spindleRPM}
						onChange={(spindleRPM) => onParamChange({ spindleRPM })}
					/>
					<Field
						label="Spin-up dwell"
						suffix="s"
						min={0}
						value={params.spindleDwell}
						onChange={(spindleDwell) => onParamChange({ spindleDwell })}
					/>
					<Field
						label="Plunge feed"
						suffix={feedSuffix}
						min={1}
						value={params.plungeFeedrate}
						onChange={(plungeFeedrate) => onParamChange({ plungeFeedrate })}
					/>
					<div className="flex items-center justify-between gap-2">
						<span className="text-sm text-gray-600 dark:text-gray-300">
							Aux output
						</span>
						<Segmented<AuxOutput>
							value={params.auxOutput}
							options={[
								{ value: "none", label: "Off" },
								{ value: "mist", label: "M7" },
								{ value: "flood", label: "M8" },
							]}
							onChange={(auxOutput) => onParamChange({ auxOutput })}
						/>
					</div>
				</div>

				{points.length > 0 && (
					<div className="space-y-2">
						<span className={sectionLabel}>Spots</span>
						<ul className="space-y-1">
							{points.map((pt, i) => (
								<li
									key={`${pt.x},${pt.y},${i}`}
									className="flex items-center justify-between gap-2 rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-700"
								>
									<span className="text-gray-600 dark:text-gray-300">
										#{i + 1} — X{pt.x.toFixed(2)} Y{pt.y.toFixed(2)}
									</span>
									<button
										type="button"
										aria-label={`Delete spot ${i + 1}`}
										onClick={() => onRemovePoint(i)}
										className="rounded px-1 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800"
									>
										✕
									</button>
								</li>
							))}
						</ul>
					</div>
				)}

				<p className="text-xs text-gray-500 dark:text-gray-400">
					Confirm your work zero (XYZ) and tool length are set before running —
					Screw Spot uses them as-is.
				</p>
			</div>

			<div className="flex items-center justify-between gap-2 border-t border-gray-200 px-1 py-3 dark:border-gray-700">
				<span className="text-sm text-gray-600 dark:text-gray-300">
					{points.length} {points.length === 1 ? "point" : "points"}
					{points.length > 0 && (
						<span className="text-gray-400"> · {lineCount} lines</span>
					)}
				</span>
				<div className="flex items-center gap-2">
					<button
						type="button"
						disabled={points.length === 0}
						onClick={onClear}
						className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
					>
						Clear
					</button>
					<button
						type="button"
						title={canRun ? "" : runDisabledReason}
						disabled={!canRun}
						onClick={onRun}
						className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
					>
						Run
					</button>
				</div>
			</div>
		</div>
	);
}

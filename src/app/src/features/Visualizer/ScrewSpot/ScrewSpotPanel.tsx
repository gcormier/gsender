import { Button } from "app/components/Button";
import { ControlledInput } from "app/components/ControlledInput";
import Tooltip from "app/components/Tooltip";
import type { UNITS_EN } from "app/definitions/general";
import cx from "classnames";
import { Check, Trash2, X } from "lucide-react";
import type {
	AuxOutput,
	ScrewSpotParams,
	ScrewSpotPoint,
	ZReference,
} from "./definitions";

interface ScrewSpotPanelProps {
	params: ScrewSpotParams;
	points: ScrewSpotPoint[];
	units: UNITS_EN;
	canRun: boolean;
	runDisabledReason: string;
	onParamChange: (patch: Partial<ScrewSpotParams>) => void;
	onClear: () => void;
	onRun: () => void;
	onClose: () => void;
}

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
		<div className="inline-flex rounded-md border border-gray-300 dark:border-dark-lighter overflow-hidden">
			{options.map((opt) => (
				<button
					key={opt.value}
					type="button"
					onClick={() => onChange(opt.value)}
					className={cx(
						"px-3 py-1 text-sm transition-colors",
						value === opt.value
							? "bg-blue-500 text-white"
							: "bg-white text-gray-600 hover:bg-gray-100 dark:bg-dark dark:text-gray-300 dark:hover:bg-dark-lighter",
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
	return (
		<label className="flex items-center justify-between gap-2">
			<span className="text-sm text-gray-600 dark:text-gray-300">{label}</span>
			<ControlledInput
				type="number"
				suffix={suffix}
				min={min}
				value={value}
				wrapperClassName="w-28"
				className="text-right"
				onChange={(e) => onChange(Number(e.target.value))}
			/>
		</label>
	);
}

/**
 * Right-docked settings panel for Screw Spot. Rendered as an absolutely-positioned
 * card over the visualizer (not a modal Sheet) so the canvas stays live for picking.
 */
export function ScrewSpotPanel({
	params,
	points,
	units,
	canRun,
	runDisabledReason,
	onParamChange,
	onClear,
	onRun,
	onClose,
}: ScrewSpotPanelProps) {
	const feedSuffix = `${units}/min`;

	return (
		<div className="absolute right-2 top-2 bottom-2 z-[10001] flex w-72 flex-col rounded-lg border border-gray-300 bg-white/95 shadow-xl backdrop-blur dark:border-dark-lighter dark:bg-dark/95">
			<div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-dark-lighter">
				<div className="flex flex-col">
					<span className="font-semibold text-gray-800 dark:text-gray-100">
						Screw Spot
					</span>
					<span className="text-xs text-gray-500 dark:text-gray-400">
						Click safe spots on the job, then run
					</span>
				</div>
				<button
					type="button"
					aria-label="Close Screw Spot"
					onClick={onClose}
					className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-dark-lighter"
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			<div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
				<div className="space-y-2">
					<span className="text-xs font-medium uppercase text-gray-400">
						Depth
					</span>
					<div className="flex items-center justify-between gap-2">
						<span className="text-sm text-gray-600 dark:text-gray-300">
							Z zero at
						</span>
						<Segmented<ZReference>
							value={params.zReference}
							options={[
								{ value: "stockTop", label: "Stock top" },
								{ value: "spoilboard", label: "Spoilboard" },
							]}
							onChange={(zReference) => onParamChange({ zReference })}
						/>
					</div>
					{params.zReference === "stockTop" && (
						<Field
							label="Stock thickness"
							suffix={units}
							min={0}
							value={params.stockThickness}
							onChange={(stockThickness) => onParamChange({ stockThickness })}
						/>
					)}
					<Field
						label="Spot depth"
						suffix={units}
						min={0}
						value={params.spotDepth}
						onChange={(spotDepth) => onParamChange({ spotDepth })}
					/>
				</div>

				<div className="space-y-2">
					<span className="text-xs font-medium uppercase text-gray-400">
						Preview
					</span>
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
					<span className="text-xs font-medium uppercase text-gray-400">
						Spindle &amp; motion
					</span>
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
					<Field
						label="Retract clearance"
						suffix={units}
						min={0}
						value={params.retractHeight}
						onChange={(retractHeight) => onParamChange({ retractHeight })}
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

				<p className="text-xs text-gray-500 dark:text-gray-400">
					Confirm your work zero (XYZ) and tool length are set before running —
					Screw Spot uses them as-is.
				</p>
			</div>

			<div className="flex items-center justify-between gap-2 border-t border-gray-200 px-4 py-3 dark:border-dark-lighter">
				<span className="text-sm text-gray-600 dark:text-gray-300">
					{points.length} {points.length === 1 ? "point" : "points"}
				</span>
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						disabled={points.length === 0}
						onClick={onClear}
						icon={<Trash2 className="h-4 w-4" />}
						text="Clear"
					/>
					<Tooltip content={canRun ? "" : runDisabledReason}>
						<Button
							variant="primary"
							size="sm"
							disabled={!canRun}
							onClick={onRun}
							icon={<Check className="h-4 w-4" />}
							text="Run"
						/>
					</Tooltip>
				</div>
			</div>
		</div>
	);
}

// SDK-adapted port of gSender's `getSafeRetractCode()`
// (src/app/src/features/DRO/utils/SafeMove.ts). The native helper reads directly
// from the host `store` / `controller` singletons; a plugin has no such access, so
// we take the same values from the bridge snapshots instead:
//   - `workspace.safeRetractHeight`  -> workspace state (useWorkspaceState)
//   - homing enabled ($22)           -> redux `controller.settings.settings.$22`
//   - current machine Z (mpos.z)     -> redux `controller.mpos.z`
// Logic is otherwise identical: when homing is on, retract in machine space (G53)
// only if currently below the safe height; otherwise retract incrementally (G91).

interface SafeRetractInputs {
	safeRetractHeight: number; // workspace.safeRetractHeight (-1 when unset)
	homingEnabled: boolean; // $22 !== 0
	currentMachineZ: number; // controller mpos.z
}

export function getSafeRetractCode({
	safeRetractHeight,
	homingEnabled,
	currentMachineZ,
}: SafeRetractInputs): string[] {
	const code: string[] = [];
	const retractHeight = Number(safeRetractHeight);

	if (retractHeight === 0) {
		return code;
	}

	if (homingEnabled) {
		const retract = Math.abs(retractHeight) * -1;
		if (currentMachineZ < retract) {
			code.push(`G53 G0 Z${retract}`);
		}
	} else {
		code.push("G91");
		code.push(`G0Z${retractHeight}`);
	}

	return code;
}

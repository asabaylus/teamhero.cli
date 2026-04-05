const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

function isTruthy(value: string | undefined | null): boolean {
	if (!value) {
		return false;
	}
	return TRUTHY_VALUES.has(value.toLowerCase());
}

export function isHeadlessEnvironment(): boolean {
	if (isTruthy(process.env.TEAMHERO_HEADLESS)) {
		return true;
	}
	return isTruthy(process.env.CI);
}

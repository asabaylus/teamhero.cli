import type { Mock } from "bun:test";
export function mocked<T extends (...args: any[]) => any>(fn: T): Mock<T> {
	return fn as unknown as Mock<T>;
}

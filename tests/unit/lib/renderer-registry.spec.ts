import { describe, expect, it } from "bun:test";
import type { ReportRenderer } from "../../../src/core/types.js";
import {
	RendererRegistry,
	createDefaultRegistry,
} from "../../../src/lib/renderer-registry.js";
import type { ReportRenderInput } from "../../../src/lib/report-renderer.js";

function makeRenderer(
	name: string,
	description = "Test renderer",
): ReportRenderer {
	return {
		name,
		description,
		render: (_input: ReportRenderInput) => `rendered by ${name}`,
	};
}

describe("RendererRegistry", () => {
	describe("register / get", () => {
		it("returns undefined for an unregistered name", () => {
			const registry = new RendererRegistry();
			expect(registry.get("unknown")).toBeUndefined();
		});

		it("returns the renderer after registration", () => {
			const registry = new RendererRegistry();
			const renderer = makeRenderer("foo");
			registry.register(renderer);
			expect(registry.get("foo")).toBe(renderer);
		});

		it("overwrites a previously registered renderer with the same name", () => {
			const registry = new RendererRegistry();
			const first = makeRenderer("foo", "first");
			const second = makeRenderer("foo", "second");
			registry.register(first);
			registry.register(second);
			expect(registry.get("foo")).toBe(second);
		});
	});

	describe("getOrThrow", () => {
		it("returns the renderer when found", () => {
			const registry = new RendererRegistry();
			const renderer = makeRenderer("bar");
			registry.register(renderer);
			expect(registry.getOrThrow("bar")).toBe(renderer);
		});

		it("throws with an informative message when the name is unknown", () => {
			const registry = new RendererRegistry();
			registry.register(makeRenderer("alpha"));
			registry.register(makeRenderer("beta"));
			expect(() => registry.getOrThrow("gamma")).toThrow(
				/Unknown template "gamma"\. Available: alpha, beta/,
			);
		});

		it("lists all registered names in the error when nothing is registered", () => {
			const registry = new RendererRegistry();
			expect(() => registry.getOrThrow("any")).toThrow(
				/Unknown template "any"\. Available: /,
			);
		});
	});

	describe("list", () => {
		it("returns an empty array when nothing is registered", () => {
			const registry = new RendererRegistry();
			expect(registry.list()).toEqual([]);
		});

		it("returns all registered renderers", () => {
			const registry = new RendererRegistry();
			const a = makeRenderer("a");
			const b = makeRenderer("b");
			registry.register(a);
			registry.register(b);
			const listed = registry.list();
			expect(listed).toHaveLength(2);
			expect(listed).toContain(a);
			expect(listed).toContain(b);
		});
	});
});

describe("createDefaultRegistry", () => {
	it("includes the 'detailed' renderer", () => {
		const registry = createDefaultRegistry();
		const renderer = registry.get("detailed");
		expect(renderer).toBeDefined();
		expect(renderer?.name).toBe("detailed");
	});

	it("getOrThrow does not throw for 'detailed'", () => {
		const registry = createDefaultRegistry();
		expect(() => registry.getOrThrow("detailed")).not.toThrow();
	});

	it("includes the 'executive' renderer", () => {
		const registry = createDefaultRegistry();
		const renderer = registry.get("executive");
		expect(renderer).toBeDefined();
		expect(renderer?.name).toBe("executive");
	});

	it("getOrThrow does not throw for 'executive'", () => {
		const registry = createDefaultRegistry();
		expect(() => registry.getOrThrow("executive")).not.toThrow();
	});

	it("resolves the individual renderer", () => {
		const registry = createDefaultRegistry();
		expect(() => registry.getOrThrow("individual")).not.toThrow();
	});

	it("throws for an unregistered template name", () => {
		const registry = createDefaultRegistry();
		expect(() => registry.getOrThrow("nonexistent")).toThrow(
			/Unknown template "nonexistent"/,
		);
	});

	it("lists at least one renderer", () => {
		const registry = createDefaultRegistry();
		expect(registry.list().length).toBeGreaterThanOrEqual(1);
	});
});

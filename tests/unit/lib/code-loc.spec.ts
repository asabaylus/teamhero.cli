import { describe, expect, it } from "bun:test";
import {
	type FileLineChange,
	isExcludedFromCodeLoc,
	matchesGlob,
	splitLoc,
} from "../../../src/lib/code-loc.js";

describe("isExcludedFromCodeLoc", () => {
	it("excludes data and serialized formats anywhere in the tree", () => {
		for (const p of [
			"data/users.csv",
			"src/fixtures/big.json",
			"notes.txt",
			"analysis/explore.ipynb",
		]) {
			expect(isExcludedFromCodeLoc(p)).toBe(true);
		}
	});

	it("excludes lockfiles", () => {
		expect(isExcludedFromCodeLoc("bun.lock")).toBe(true);
		expect(isExcludedFromCodeLoc("uv.lock")).toBe(true);
		expect(isExcludedFromCodeLoc("frontend/pnpm-lock.yaml")).toBe(true);
	});

	it("excludes tokenizers and binary model artifacts", () => {
		for (const p of [
			"models/tokenizer.model",
			"app_tokenizer_config.py",
			"weights/model.bin",
			"weights/model.onnx",
			"weights/model.safetensors",
			"weights/model.gguf",
		]) {
			expect(isExcludedFromCodeLoc(p)).toBe(true);
		}
	});

	it("excludes vendored OpenAPI specs and EF Core migration designer files", () => {
		expect(isExcludedFromCodeLoc("vendor/openapi.yaml")).toBe(true);
		expect(isExcludedFromCodeLoc("api/spec/swagger.yml")).toBe(true);
		expect(
			isExcludedFromCodeLoc("src/Data/migrations/0001_Init.Designer.cs"),
		).toBe(true);
	});

	it("excludes a top-level migrations designer file (** matches zero dirs)", () => {
		expect(isExcludedFromCodeLoc("migrations/0001_Init.Designer.cs")).toBe(
			true,
		);
	});

	it("keeps hand-written source as code", () => {
		for (const p of [
			"src/lib/code-loc.ts",
			"tui/main.go",
			"scripts/run.py",
			"src/Data/migrations/0001_Init.cs", // real migration code, not .Designer.cs
			"docs/openapi-notes.md",
		]) {
			expect(isExcludedFromCodeLoc(p)).toBe(false);
		}
	});
});

describe("matchesGlob", () => {
	it("matches a slashless glob against the basename at any depth", () => {
		expect(matchesGlob("a/b/c.csv", "*.csv")).toBe(true);
		expect(matchesGlob("c.csv", "*.csv")).toBe(true);
	});
	it("anchors a glob containing a slash to the full path", () => {
		expect(
			matchesGlob("x/migrations/y.Designer.cs", "**/migrations/*.Designer.cs"),
		).toBe(true);
		expect(
			matchesGlob("x/other/y.Designer.cs", "**/migrations/*.Designer.cs"),
		).toBe(false);
	});
	it("does not let * cross directory boundaries", () => {
		expect(matchesGlob("a/b.json", "*.json")).toBe(true);
		// '*' is non-slash, so a slashless json glob still matches on basename only
		expect(matchesGlob("a.json.bak", "*.json")).toBe(false);
	});
	it("matches a slashless ** glob against the full path (per the contract)", () => {
		// A `**` glob spans directories, so it anchors at the repo root, not the
		// basename — a basename-only match would wrongly accept `app/vendor/x.ts`.
		expect(matchesGlob("vendor/lib/x.ts", "vendor**")).toBe(true);
		expect(matchesGlob("app/vendor/x.ts", "vendor**")).toBe(false);
	});
});

describe("splitLoc", () => {
	it("counts raw across all files but excludes data/generated from code", () => {
		const files: FileLineChange[] = [
			{ path: "data/huge.json", additions: 1_160_000, deletions: 0 },
			{ path: "src/app.ts", additions: 120, deletions: 30 },
			{ path: "tokenizer.model", additions: 5000, deletions: 0 },
		];
		const split = splitLoc(files);
		expect(split.rawAdditions).toBe(1_165_120);
		expect(split.rawDeletions).toBe(30);
		// Only the hand-written source counts toward code LoC.
		expect(split.codeAdditions).toBe(120);
		expect(split.codeDeletions).toBe(30);
	});

	it("returns zeros for no files", () => {
		expect(splitLoc([])).toEqual({
			rawAdditions: 0,
			rawDeletions: 0,
			codeAdditions: 0,
			codeDeletions: 0,
		});
	});
});

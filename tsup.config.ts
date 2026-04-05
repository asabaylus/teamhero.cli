import { defineConfig } from "tsup";

export default defineConfig([
	{
		entry: { index: "src/cli/index.ts" },
		format: ["esm"],
		splitting: false,
		sourcemap: true,
		clean: true,
		target: "node20",
		outDir: "dist/cli",
		dts: true,
		platform: "node",
	},
	{
		entry: { index: "src/mcp/index.ts" },
		format: ["esm"],
		splitting: false,
		sourcemap: true,
		clean: true,
		target: "node20",
		outDir: "dist/mcp",
		dts: true,
		platform: "node",
	},
]);

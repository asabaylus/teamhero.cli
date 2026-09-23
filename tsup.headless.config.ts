import { defineConfig } from "tsup";

/** TypeScript-only build for servers and CI hosts without the Go toolchain. */
export default defineConfig({
	entry: { index: "src/cli/index.ts" },
	format: ["esm"],
	splitting: false,
	sourcemap: true,
	clean: true,
	target: "node20",
	outDir: "dist/cli",
	dts: true,
	platform: "node",
});

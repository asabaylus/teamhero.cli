import type { ReportRenderer } from "../core/types.js";
import { executiveRenderer } from "./renderers/executive.js";
import { individualRenderer } from "./renderers/individual.js";
import { detailedRenderer } from "./report-renderer.js";

export class RendererRegistry {
	private readonly renderers = new Map<string, ReportRenderer>();

	register(renderer: ReportRenderer): void {
		this.renderers.set(renderer.name, renderer);
	}

	get(name: string): ReportRenderer | undefined {
		return this.renderers.get(name);
	}

	getOrThrow(name: string): ReportRenderer {
		const renderer = this.renderers.get(name);
		if (!renderer) {
			const available = [...this.renderers.keys()].join(", ");
			throw new Error(`Unknown template "${name}". Available: ${available}`);
		}
		return renderer;
	}

	list(): ReportRenderer[] {
		return [...this.renderers.values()];
	}
}

export function createDefaultRegistry(): RendererRegistry {
	const registry = new RendererRegistry();
	registry.register(detailedRenderer);
	registry.register(executiveRenderer);
	registry.register(individualRenderer);
	return registry;
}

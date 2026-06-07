export const RUBRIC_VERSION = "1.0.0";

export type DimensionId =
	| "upfront-design"
	| "context-engineering"
	| "critical-evaluation"
	| "verification"
	| "course-correction"
	| "risk-awareness"
	| "architectural-quality"
	| "test-pass"
	| "throughput";

export type EvidenceMode = "deterministic" | "hybrid" | "llm-judge";

export type DimensionGroup = "process" | "outcome";

export interface Dimension {
	readonly id: DimensionId;
	readonly title: string;
	readonly description: string;
	readonly evidenceMode: EvidenceMode;
	readonly group: DimensionGroup;
	readonly maturityLineage: readonly string[];
}

const DIMENSIONS: readonly Dimension[] = [
	{
		id: "upfront-design",
		title: "Upfront Design Discipline",
		description:
			"Does the candidate sketch architecture, identify constraints, and align on approach before generating code?",
		evidenceMode: "llm-judge",
		group: "process",
		maturityLineage: ["D12"],
	},
	{
		id: "context-engineering",
		title: "Context Engineering",
		description:
			"How effectively the candidate primes the AI with relevant repository context, constraints, and intent before each significant prompt.",
		evidenceMode: "hybrid",
		group: "process",
		maturityLineage: ["D12"],
	},
	{
		id: "critical-evaluation",
		title: "Critical Evaluation of AI Output",
		description:
			"How the candidate reads, interrogates, and challenges AI-generated code rather than accepting it on faith.",
		evidenceMode: "llm-judge",
		group: "process",
		maturityLineage: ["D12"],
	},
	{
		id: "verification",
		title: "Verification Behavior",
		description:
			"Frequency and rigor of test runs, type checks, and manual verification interleaved between AI exchanges.",
		evidenceMode: "deterministic",
		group: "process",
		maturityLineage: ["D12"],
	},
	{
		id: "course-correction",
		title: "Course Correction",
		description:
			"How the candidate notices, names, and recovers from AI mistakes or their own missteps mid-task.",
		evidenceMode: "hybrid",
		group: "process",
		maturityLineage: ["D12"],
	},
	{
		id: "risk-awareness",
		title: "Risk Awareness",
		description:
			"Recognition of destructive operations, security implications, and reversibility before acting on AI suggestions.",
		evidenceMode: "deterministic",
		group: "process",
		maturityLineage: ["D12"],
	},
	{
		id: "architectural-quality",
		title: "Architectural Quality of Output",
		description:
			"Whether the final code reflects sound modularity, naming, and separation of concerns.",
		evidenceMode: "llm-judge",
		group: "outcome",
		maturityLineage: ["D12"],
	},
	{
		id: "test-pass",
		title: "Test Outcome",
		description:
			"Whether the candidate's submitted solution passes the role-specific acceptance tests.",
		evidenceMode: "deterministic",
		group: "outcome",
		maturityLineage: ["D12"],
	},
	{
		id: "throughput",
		title: "Throughput",
		description:
			"Volume of meaningful progress within the time-box, measured as commits, completed features, or tests passed.",
		evidenceMode: "deterministic",
		group: "outcome",
		maturityLineage: ["D12"],
	},
];

export function getRubricVersion(): string {
	return RUBRIC_VERSION;
}

export function getDimensions(): readonly Dimension[] {
	return DIMENSIONS;
}

export function getDimension(id: DimensionId): Dimension | undefined {
	return DIMENSIONS.find((d) => d.id === id);
}

export function getEvidenceMode(id: DimensionId): EvidenceMode | undefined {
	return getDimension(id)?.evidenceMode;
}

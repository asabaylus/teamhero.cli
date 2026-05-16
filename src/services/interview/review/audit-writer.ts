import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDimensions } from "../shared/rubric.js";
import type { ReviewResult, Measurement, Observation } from "./types.js";

/**
 * Audit writer. Pure transformation from ReviewResult to the per-candidate
 * audit folder layout (summary.md / audit.md / audit.json). Reasoning chains
 * are preserved in BOTH summary.md and audit.md.
 */

export interface AuditFrontmatter {
	readonly tags: readonly string[];
	readonly candidate: string;
	readonly role: string;
	readonly date: string; // YYYY-MM-DD
	readonly rubric_version: string;
	readonly rubric_mode: string;
	readonly signed_off: boolean;
	/** Categorical sign-off result. Present only when signed_off is true. */
	readonly recommendation?: "Hire" | "Hire with notes" | "No hire";
	readonly session_recording_url?: string;
	readonly session_platform?: string;
	readonly session_date?: string;
}

export interface WriteAuditInput {
	readonly result: ReviewResult;
	readonly frontmatter: AuditFrontmatter;
	readonly outputDir: string;
}

const WARNING_BANNER = `⚠ THIS AUDIT IS ADVISORY. Hiring decisions are made by humans using
professional judgment. The candidate is a person, not a score. This rubric
is one factor among many; your evaluation is the primary, first, and most
important basis for your decision.`;

const SIGN_OFF_PLACEHOLDER = `## Sign-off (MANDATORY)

This audit is not complete until a hiring manager has read the
observations above and written a categorical recommendation along with
a reasoning summary in their own words. The TUI rejects empty submissions.

**Recommendation:** \`\` (Hire | Hire with notes | No hire)

**Manager reasoning (write your own summary; do not leave blank):**

> _Write 3–6 sentences in your own words. What stood out? What gave you
> pause? Which observations did you weigh most heavily and why? Do not
> simply restate the AI's observations — give your own read._
`;

// Quote any YAML scalar that could be misparsed by a YAML reader: contains
// colons, # comments, leading/trailing whitespace, or starts with a YAML
// indicator. Within the double-quoted form we escape ALL ASCII control
// characters (C0: \x00–\x1F, plus \x7F) as `\xHH` per YAML 1.2 §5.7 — a
// raw control character in a double-quoted scalar is a parse error in
// strict YAML parsers (js-yaml FAILSAFE, libyaml). Candidate names with
// stray control characters from copy-paste otherwise corrupt the
// audit.json round-trip silently.
function escapeYamlDoubleQuoted(value: string): string {
	let out = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	out = out.replace(/[\x00-\x1F\x7F]/g, (c) => {
		switch (c) {
			case "\n":
				return "\\n";
			case "\r":
				return "\\r";
			case "\t":
				return "\\t";
			case "\0":
				return "\\0";
			case "\b":
				return "\\b";
			case "\f":
				return "\\f";
			case "\v":
				return "\\v";
			default: {
				const hex = c.charCodeAt(0).toString(16).padStart(2, "0");
				return `\\x${hex}`;
			}
		}
	});
	return out;
}

function yamlScalar(value: string): string {
	if (
		value.length === 0 ||
		/[:#\n\r\t"\\]/.test(value) ||
		/^[\s\-?\[\]{},&*!|>'%@`]/.test(value) ||
		value.trim() !== value
	) {
		return `"${escapeYamlDoubleQuoted(value)}"`;
	}
	return value;
}

function yamlTag(value: string): string {
	if (/[:,\[\]{}#&*!|>'"%@`\s]/.test(value)) {
		return `"${escapeYamlDoubleQuoted(value)}"`;
	}
	return value;
}

function yaml(value: AuditFrontmatter): string {
	const lines: string[] = ["---"];
	lines.push(`tags: [${value.tags.map(yamlTag).join(", ")}]`);
	lines.push(`candidate: ${yamlScalar(value.candidate)}`);
	lines.push(`role: ${yamlScalar(value.role)}`);
	lines.push(`date: ${yamlScalar(value.date)}`);
	lines.push(`rubric_version: ${yamlScalar(value.rubric_version)}`);
	lines.push(`rubric_mode: ${yamlScalar(value.rubric_mode)}`);
	lines.push(`signed_off: ${value.signed_off}`);
	if (value.recommendation !== undefined) {
		lines.push(`recommendation: ${yamlScalar(value.recommendation)}`);
	}
	if (value.session_recording_url !== undefined) {
		lines.push(
			`session_recording_url: ${yamlScalar(value.session_recording_url)}`,
		);
	}
	if (value.session_platform !== undefined) {
		lines.push(`session_platform: ${yamlScalar(value.session_platform)}`);
	}
	if (value.session_date !== undefined) {
		lines.push(`session_date: ${yamlScalar(value.session_date)}`);
	}
	lines.push("---");
	return lines.join("\n");
}

function obsByDim(
	observations: readonly Observation[],
): Map<string, Observation> {
	const map = new Map<string, Observation>();
	for (const o of observations) map.set(o.dimension_id, o);
	return map;
}

function measByDim(
	measurements: readonly Measurement[],
): Map<string, Measurement> {
	const map = new Map<string, Measurement>();
	for (const m of measurements) map.set(m.dimension_id, m);
	return map;
}

function renderObservation(o: Observation): string {
	const lines: string[] = [];
	lines.push(`**Observation:** ${o.observation}`);
	lines.push(`**Reasoning:** ${o.reasoning}`);
	if (o.evidence_excerpts.length > 0) {
		lines.push("**Evidence:**");
		for (const e of o.evidence_excerpts) {
			const ts = e.timestamp ? ` [${e.timestamp}]` : "";
			const content = e.content.length > 200 ? `${e.content.slice(0, 200)}…` : e.content;
			lines.push(`- (${e.source})${ts} ${content}`);
		}
	}
	if (o.caveats) lines.push(`**Caveats:** ${o.caveats}`);
	return lines.join("\n");
}

function renderObservationFull(o: Observation): string {
	const lines: string[] = [];
	lines.push(`**Observation:** ${o.observation}`);
	lines.push(`**Reasoning:** ${o.reasoning}`);
	if (o.evidence_excerpts.length > 0) {
		lines.push("**Evidence (full):**");
		for (const e of o.evidence_excerpts) {
			const ts = e.timestamp ? ` [${e.timestamp}]` : "";
			lines.push(`- (${e.source})${ts} ${e.content}`);
		}
	}
	if (o.caveats) lines.push(`**Caveats:** ${o.caveats}`);
	return lines.join("\n");
}

function renderMeasurement(m: Measurement): string {
	const lines: string[] = ["**Measurements:**"];
	for (const f of m.facts) {
		const ctx = f.context ? ` _(${f.context})_` : "";
		lines.push(`- ${f.label}: ${f.value}${ctx}`);
	}
	return lines.join("\n");
}

function renderDimensionSection(
	titlePrefix: string,
	dimensionId: string,
	dimensionTitle: string,
	observation: Observation | undefined,
	measurement: Measurement | undefined,
	rendererObservation: (o: Observation) => string,
): string {
	const lines: string[] = [];
	lines.push(`### ${titlePrefix} ${dimensionTitle}`);
	lines.push(`*(id: ${dimensionId})*`);
	if (measurement) lines.push(renderMeasurement(measurement));
	if (observation) lines.push(rendererObservation(observation));
	if (!measurement && !observation) {
		lines.push("_(No evidence captured for this dimension.)_");
	}
	return lines.join("\n\n");
}

export function renderSummary(input: WriteAuditInput): string {
	const { result, frontmatter } = input;
	const obs = obsByDim(result.observations);
	const meas = measByDim(result.measurements);
	const dims = getDimensions();

	const process = dims.filter((d) => d.group === "process");
	const outcome = dims.filter((d) => d.group === "outcome");

	const sections: string[] = [];
	sections.push(yaml(frontmatter));
	sections.push(`> ${WARNING_BANNER.split("\n").join("\n> ")}`);
	sections.push(`# Candidate observations: ${frontmatter.candidate}`);
	sections.push("## Process dimensions");
	process.forEach((d, i) => {
		sections.push(
			renderDimensionSection(
				`${i + 1}.`,
				d.id,
				d.title,
				obs.get(d.id),
				meas.get(d.id),
				renderObservation,
			),
		);
	});
	sections.push("## Outcome dimensions");
	outcome.forEach((d, i) => {
		sections.push(
			renderDimensionSection(
				`${process.length + i + 1}.`,
				d.id,
				d.title,
				obs.get(d.id),
				meas.get(d.id),
				renderObservation,
			),
		);
	});
	sections.push(SIGN_OFF_PLACEHOLDER);
	return `${sections.join("\n\n")}\n`;
}

export function renderAudit(input: WriteAuditInput): string {
	const { result, frontmatter } = input;
	const obs = obsByDim(result.observations);
	const meas = measByDim(result.measurements);
	const dims = getDimensions();

	const sections: string[] = [];
	sections.push(yaml(frontmatter));
	sections.push(`> ${WARNING_BANNER.split("\n").join("\n> ")}`);
	sections.push(`# Full audit: ${frontmatter.candidate}`);
	sections.push(
		"This document preserves the full evidence excerpts and the AI observer's reasoning chain for every dimension. It is the canonical source for any appeal review.",
	);

	dims.forEach((d, i) => {
		sections.push(
			renderDimensionSection(
				`${i + 1}.`,
				d.id,
				d.title,
				obs.get(d.id),
				meas.get(d.id),
				renderObservationFull,
			),
		);
	});
	sections.push(SIGN_OFF_PLACEHOLDER);
	return `${sections.join("\n\n")}\n`;
}

export interface AuditWriteOutputs {
	readonly summaryPath: string;
	readonly auditPath: string;
	readonly auditJsonPath: string;
	readonly evidenceDir: string;
}

export function writeAudit(input: WriteAuditInput): AuditWriteOutputs {
	mkdirSync(input.outputDir, { recursive: true });
	const summary = renderSummary(input);
	const audit = renderAudit(input);
	const auditJson = JSON.stringify(
		{ frontmatter: input.frontmatter, result: input.result },
		null,
		2,
	);
	const summaryPath = join(input.outputDir, "summary.md");
	const auditPath = join(input.outputDir, "audit.md");
	const auditJsonPath = join(input.outputDir, "audit.json");
	const evidenceDir = join(input.outputDir, "evidence");
	mkdirSync(evidenceDir, { recursive: true });
	writeFileSync(summaryPath, summary, "utf8");
	writeFileSync(auditPath, audit, "utf8");
	writeFileSync(auditJsonPath, `${auditJson}\n`, "utf8");
	return { summaryPath, auditPath, auditJsonPath, evidenceDir };
}

/** Validates a manager-written sign-off. Used by the TUI sign-off prompt. */
export function validateSignOff(input: {
	readonly recommendation: string;
	readonly reasoning: string;
}): { readonly ok: boolean; readonly failures: readonly string[] } {
	const failures: string[] = [];
	const validRecs = ["Hire", "Hire with notes", "No hire"];
	if (!validRecs.includes(input.recommendation)) {
		failures.push(
			`recommendation must be one of: ${validRecs.map((v) => `"${v}"`).join(", ")}`,
		);
	}
	const trimmed = (input.reasoning ?? "").trim();
	if (trimmed.length < 20) {
		failures.push(
			"reasoning summary must be at least 20 characters — write your own words, do not leave blank or restate the AI's observations",
		);
	}
	return { ok: failures.length === 0, failures };
}

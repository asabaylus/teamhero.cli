import type { ReportMemberMetrics } from "./report-renderer.js";

export interface ContributorReportOptions {
	detailed: boolean;
}

export function renderContributorReport(
	member: ReportMemberMetrics,
	options: ContributorReportOptions,
): string {
	const header = `### ${member.displayName} (@${member.login})`;
	const body = options.detailed
		? renderDetailedBody(member)
		: renderSummaryBody(member);
	return [header, "", body].join("\n").trimEnd();
}

function renderDetailedBody(member: ReportMemberMetrics): string {
	const sections: Array<{ title: string; lines: string[] }> = [
		{
			title: "Summary:",
			lines: [buildDetailedSummary(member)],
		},
		{
			title: "Open pull requests:",
			lines: buildOpenPullRequests(member),
		},
		{
			title: "Supporting commit highlights:",
			lines: buildCommitHighlights(member),
		},
		{
			title: "Merged pull requests:",
			lines: buildMergedPullRequests(member),
		},
		{
			title: "Closed pull requests:",
			lines: buildClosedPullRequests(member),
		},
		{
			title: "Supporting commits:",
			lines: buildSupportingCommits(member),
		},
		{
			title: "Completed tasks:",
			lines: buildCompletedTasks(member),
		},
	];

	return sections
		.map((section) => {
			const content = section.lines.length > 0 ? section.lines : ["- None"];
			return [section.title, ...content].join("\n");
		})
		.join("\n\n");
}

function renderSummaryBody(member: ReportMemberMetrics): string {
	const paragraphs: string[] = [];
	const summaryPieces = buildSummarySentences(member);

	if (summaryPieces.length === 0) {
		summaryPieces.push(
			`${member.displayName} had no recorded pull requests, commits, or Asana tasks during this window.`,
		);
	}

	for (const sentence of summaryPieces) {
		if (sentence.trim().length > 0) {
			paragraphs.push(sentence.trim());
		}
	}

	if (paragraphs.length === 1) {
		paragraphs.push(
			`${member.displayName} focused on steady operational support, keeping the delivery pipeline stable for the team.`,
		);
	}

	const body = paragraphs
		.map((paragraph) => sanitizeForSummary(paragraph))
		.filter((paragraph) => paragraph.length > 0)
		.join("\n\n");

	return body;
}

function buildDetailedSummary(member: ReportMemberMetrics): string {
	const sentences: string[] = [];

	const taskSentence = buildTaskSentence(member, "short");
	if (taskSentence) {
		sentences.push(taskSentence);
	}

	const prSentence = buildPullRequestSentence(member, "short");
	if (prSentence) {
		sentences.push(prSentence);
	}

	if (sentences.length === 0) {
		sentences.push(
			`${member.displayName} had limited shipping activity during this window.`,
		);
	}

	return sentences.slice(0, 2).join(" ");
}

function buildSummarySentences(member: ReportMemberMetrics): string[] {
	const sentences: string[] = [];

	const taskSentence = buildTaskSentence(member, "long");
	if (taskSentence) {
		sentences.push(taskSentence);
	}

	const prSentence = buildPullRequestSentence(member, "long");
	if (prSentence) {
		sentences.push(prSentence);
	}

	const commitSentence = buildCommitSentence(member);
	if (commitSentence) {
		sentences.push(commitSentence);
	}

	return sentences.slice(0, 3);
}

function buildTaskSentence(
	member: ReportMemberMetrics,
	mode: "short" | "long",
): string | null {
	const completed = (member.taskTracker.tasks ?? []).filter((task) =>
		Boolean(task.completedAt),
	);
	if (completed.length === 0) {
		if (mode === "short") {
			return null;
		}
		return `${member.displayName} recorded no completed Asana tasks during this period.`;
	}

	const taskNarratives = completed
		.map((task) => summarizeTaskNarrative(task))
		.filter((descriptor): descriptor is string => descriptor.length > 0);

	if (taskNarratives.length === 0) {
		return null;
	}

	const formattedList = formatList(taskNarratives.map(sanitizeForSummary));
	if (mode === "short") {
		return `${member.displayName} advanced operational work covering ${formattedList}, keeping delivery aligned with business expectations.`;
	}

	return `${member.displayName} progressed Asana initiatives focused on ${formattedList}, complementing the engineering throughput with timely operational follow-through.`;
}

function summarizeTaskNarrative(
	task: ReportMemberMetrics["asana"]["tasks"][number],
): string {
	const sources = [task.description, ...(task.comments ?? [])]
		.map((value) => (value ?? "").replace(/\s+/g, " ").trim())
		.filter((value) => value.length > 0);

	if (sources.length === 0) {
		return "";
	}

	const primary = sources[0]!;
	return primary.length > 160 ? `${primary.slice(0, 157).trimEnd()}…` : primary;
}

function buildPullRequestSentence(
	member: ReportMemberMetrics,
	mode: "short" | "long",
): string | null {
	const delivered = (member.prHighlights ?? [])
		.map((highlight) => highlight.trim())
		.filter((highlight) => highlight.length > 0 && !/^No PRs/i.test(highlight));

	if (delivered.length === 0) {
		const merged = (member.rawPullRequests ?? []).filter(
			(pr) => pr.state === "MERGED",
		);
		if (merged.length === 0) {
			return null;
		}
		const titles = merged.map((pr) => sanitizeForSummary(pr.title));
		const formattedList = formatList(titles);
		return mode === "short"
			? `${member.displayName} merged updates including ${formattedList}, advancing the delivery roadmap.`
			: `${member.displayName} merged pull requests such as ${formattedList}, improving product quality and keeping the roadmap on track.`;
	}

	const formattedList = formatList(delivered.map(sanitizeForSummary));
	return mode === "short"
		? `${member.displayName} shipped changes including ${formattedList}, strengthening overall reliability.`
		: `${member.displayName} delivered pull requests like ${formattedList}, which elevate product reliability and sharpen customer-facing behavior.`;
}

function buildCommitSentence(member: ReportMemberMetrics): string | null {
	const commitHighlights = (member.commitHighlights ?? [])
		.map((highlight) => highlight.trim())
		.filter((highlight) => highlight.length > 0);

	if (commitHighlights.length === 0) {
		const rawCommits = member.rawCommits ?? [];
		if (rawCommits.length === 0) {
			return null;
		}
		const messages = rawCommits.map((commit) =>
			sanitizeForSummary(commit.message),
		);
		const formattedList = formatList(messages);
		return `${member.displayName} supported the release with commits covering ${formattedList}, smoothing ongoing maintenance.`;
	}

	const formattedList = formatList(commitHighlights.map(sanitizeForSummary));
	return `${member.displayName} reinforced the work with commits addressing ${formattedList}, reducing follow-up risk for the team.`;
}

function buildOpenPullRequests(member: ReportMemberMetrics): string[] {
	const open = (member.rawPullRequests ?? []).filter(
		(pr) => pr.state === "OPEN",
	);

	if (open.length === 0) {
		return ["- None"];
	}

	return open.map((pr) => {
		const scope = pr.repoName ? `${pr.repoName} · ` : "";
		return `- ${scope}PR #${pr.number} ${pr.title} — ${pr.url}`;
	});
}

function buildCommitHighlights(member: ReportMemberMetrics): string[] {
	const highlights = (member.commitHighlights ?? [])
		.map((highlight) => highlight.trim())
		.filter((highlight) => highlight.length > 0);

	if (highlights.length === 0) {
		return ["- None"];
	}

	return highlights.map((highlight) => {
		const match = findCommitMatch(highlight, member.rawCommits ?? []);
		if (match) {
			const date = match.committedAt
				? ` (${match.committedAt.slice(0, 10)})`
				: "";
			return `- ${highlight}${date} — ${match.url}`;
		}
		return `- ${highlight}`;
	});
}

function buildMergedPullRequests(member: ReportMemberMetrics): string[] {
	const merged = (member.rawPullRequests ?? []).filter(
		(pr) => pr.state === "MERGED",
	);

	if (merged.length === 0) {
		return ["- None"];
	}

	return merged.map((pr) => {
		const scope = pr.repoName ? `${pr.repoName} · ` : "";
		const mergedDate = pr.mergedAt
			? ` (merged ${pr.mergedAt.slice(0, 10)})`
			: "";
		return `- ${scope}PR #${pr.number} ${pr.title}${mergedDate} — ${pr.url}`;
	});
}

function buildClosedPullRequests(member: ReportMemberMetrics): string[] {
	const closed = (member.rawPullRequests ?? []).filter(
		(pr) => pr.state === "CLOSED",
	);

	if (closed.length === 0) {
		return ["- None"];
	}

	return closed.map((pr) => {
		const scope = pr.repoName ? `${pr.repoName} · ` : "";
		const closedDate = pr.mergedAt
			? ` (closed ${pr.mergedAt.slice(0, 10)})`
			: "";
		return `- ${scope}PR #${pr.number} ${pr.title}${closedDate} — ${pr.url}`;
	});
}

function buildSupportingCommits(member: ReportMemberMetrics): string[] {
	const commits = member.rawCommits ?? [];
	if (commits.length === 0) {
		return ["- None"];
	}

	return commits.map((commit) => {
		const scope = commit.repoName ? `${commit.repoName} · ` : "";
		const date = commit.committedAt
			? ` (${commit.committedAt.slice(0, 10)})`
			: "";
		const message = commit.message.replace(/\s+/g, " ").trim();
		return `- ${scope}${commit.oid.slice(0, 7)}${date}: ${message} — ${commit.url}`;
	});
}

function buildCompletedTasks(member: ReportMemberMetrics): string[] {
	const tasks = (member.taskTracker.tasks ?? []).filter((task) =>
		Boolean(task.completedAt),
	);
	if (tasks.length === 0) {
		return ["- None"];
	}

	return tasks.map((task) => {
		const when = task.completedAt
			? ` (completed ${task.completedAt.slice(0, 10)})`
			: "";
		const link = task.permalinkUrl ? ` — ${task.permalinkUrl}` : "";
		return `- ${task.name}${when}${link}`;
	});
}

function findCommitMatch(
	highlight: string,
	commits: ReportMemberMetrics["rawCommits"],
): NonNullable<ReportMemberMetrics["rawCommits"]>[number] | undefined {
	if (!commits) {
		return undefined;
	}
	const normalized = highlight.toLowerCase();
	return commits.find((commit) => {
		const message = commit.message.replace(/\s+/g, " ").toLowerCase();
		return normalized.includes(message) || message.includes(normalized);
	});
}

function formatList(items: string[]): string {
	const uniqueItems = Array.from(
		new Set(items.map((item) => item.trim())),
	).filter((item) => item.length > 0);
	if (uniqueItems.length === 0) {
		return "";
	}
	if (uniqueItems.length === 1) {
		return uniqueItems[0]!.replace(/\.$/, "").trim();
	}
	if (uniqueItems.length === 2) {
		return `${uniqueItems[0]} and ${uniqueItems[1]}`;
	}
	const head = uniqueItems.slice(0, -1).join(", ");
	const tail = uniqueItems[uniqueItems.length - 1];
	return `${head}, and ${tail}`;
}

function sanitizeForSummary(value: string): string {
	return value
		.replace(/https?:\/\/\S+/gi, "")
		.replace(/PR\s*#\d+/gi, "PR")
		.replace(/#\d+/g, "")
		.replace(/\b[0-9a-f]{7}\b/gi, "")
		.replace(/\s+/g, " ")
		.replace(/\s+,/g, ",")
		.trim();
}

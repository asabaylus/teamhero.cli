import type { ReportRenderer } from "../../core/types.js";
import type {
	ReportMemberMetrics,
	ReportRenderInput,
} from "../report-renderer.js";

function renderMemberSection(
	member: ReportMemberMetrics,
	window: { start: string; end: string },
): string {
	const parts: string[] = [];

	parts.push(`# Individual Report: ${member.displayName} (@${member.login})`);
	parts.push(`## ${window.start} – ${window.end}`);
	parts.push("");

	const observed = (
		value: number,
		observation: ReportMemberMetrics["reviewsObservation"],
	) => (observation && observation.status !== "reported" ? "—" : String(value));

	// Metrics table
	parts.push("### Metrics");
	parts.push("");
	parts.push("| Metric | Value |");
	parts.push("|--------|------:|");
	parts.push(`| Commits | ${member.commits} |`);
	parts.push(
		`| PRs Opened | ${observed(member.prsOpened, member.prActivityObservation)} |`,
	);
	parts.push(
		`| Closed (not merged) | ${observed(member.prsClosed, member.prActivityObservation)} |`,
	);
	parts.push(
		`| PRs Merged | ${observed(member.prsMerged, member.prActivityObservation)} |`,
	);
	parts.push(`| Lines Added | ${member.linesAdded} |`);
	parts.push(`| Lines Deleted | ${member.linesDeleted} |`);
	parts.push(
		`| Reviews | ${observed(member.reviews, member.reviewsObservation)} |`,
	);
	if (member.storyPointsCompleted !== undefined) {
		parts.push(
			`| Story Points | ${observed(member.storyPointsCompleted, member.storyPointsObservation)} |`,
		);
	}
	if (member.ticketsClosed !== undefined) {
		parts.push(
			`| Tickets Closed | ${observed(member.ticketsClosed, member.ticketsClosedObservation)} |`,
		);
	}
	if (member.supportTickets !== undefined) {
		parts.push(
			`| Support Tickets | ${observed(member.supportTickets, member.supportTicketsObservation)} |`,
		);
	}
	parts.push("");

	// AI Summary
	parts.push("### Summary");
	parts.push("");
	parts.push(member.aiSummary?.trim() || "_No summary available._");
	parts.push("");

	// Tasks
	parts.push("### Tasks");
	parts.push("");
	const tracker = member.taskTracker;
	const completedTasks = (tracker.tasks ?? []).filter(
		(t) => t.status === "completed" || t.completedAt,
	);
	const inProgressTasks = (tracker.tasks ?? []).filter(
		(t) => t.status !== "completed" && !t.completedAt,
	);
	const completedCount = completedTasks.length;
	const inProgressCount = inProgressTasks.length;

	if (completedCount === 0 && inProgressCount === 0) {
		parts.push("No task tracker data for this period.");
	} else {
		if (completedCount > 0) {
			parts.push(
				`${completedCount} task${completedCount === 1 ? "" : "s"} completed`,
			);
			parts.push("");
			for (const task of completedTasks) {
				parts.push(`- ${task.name}`);
			}
		}
		if (inProgressCount > 0) {
			if (completedCount > 0) {
				parts.push("");
			}
			parts.push(
				`${inProgressCount} task${inProgressCount === 1 ? "" : "s"} in progress`,
			);
		}
	}
	parts.push("");

	return parts.join("\n");
}

export const individualRenderer: ReportRenderer = {
	name: "individual",
	description: "Single-member view for standups and 1:1 prep",
	render(input: ReportRenderInput, options?: Record<string, string>): string {
		const memberLogin = options?.member;

		if (memberLogin) {
			const member = input.memberMetrics.find(
				(m) => m.login.toLowerCase() === memberLogin.toLowerCase(),
			);
			if (!member) {
				const available = input.memberMetrics.map((m) => m.login).join(", ");
				throw new Error(
					`Member "${memberLogin}" not found. Available logins: ${available}`,
				);
			}
			return renderMemberSection(member, input.window);
		}

		// No member specified — render all members as separate sections
		const sections = input.memberMetrics.map((member) =>
			renderMemberSection(member, input.window),
		);
		return sections.join("\n---\n\n");
	},
};

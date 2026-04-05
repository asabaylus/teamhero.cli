import type { Organization } from "./organization.js";

export interface Team {
	id: number;
	slug: string;
	name: string;
	organizationId: Organization["id"];
	memberLogins: string[];
}

import { config as loadDotenv } from "dotenv";

loadDotenv({ override: true });
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
// Isolate tests from any real local identity map in the working directory so a
// developer's own .teamhero/local/identity-map.yaml never changes test outcomes.
process.env.TEAMHERO_IDENTITY_MAP =
	process.env.TEAMHERO_IDENTITY_MAP ??
	"/nonexistent/teamhero-identity-map.yaml";

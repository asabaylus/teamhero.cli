#!/usr/bin/env node
import { startServer } from "./server.js";

startServer().catch((error) => {
	console.error("MCP server failed to start:", error);
	process.exit(1);
});

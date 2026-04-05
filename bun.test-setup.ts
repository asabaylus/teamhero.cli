import { config as loadDotenv } from "dotenv";
loadDotenv({ override: true });
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	ContributorSummaryPayload,
	ContributorSummaryStatus,
	ContributorSummaryUsage,
} from "../models/individual-summary.js";

export interface CacheRecord {
	login: string;
	status: ContributorSummaryStatus;
	payload: ContributorSummaryPayload;
	summary?: string;
	error?: string;
	usage?: ContributorSummaryUsage;
	updatedAt: string;
}

export interface CacheWriteInput {
	login: string;
	payload: ContributorSummaryPayload;
	status: ContributorSummaryStatus;
	summary?: string;
	error?: string;
	usage?: ContributorSummaryUsage;
}

export interface IndividualSummaryCacheOptions {
	baseDir: string;
}

export class IndividualSummaryCache {
	private readonly baseDir: string;

	constructor(options: IndividualSummaryCacheOptions) {
		this.baseDir = options.baseDir;
	}

	async write(input: CacheWriteInput): Promise<void> {
		await this.ensureDirectory();
		const filePath = this.resolvePath(input.login);
		const record: CacheRecord = {
			login: input.login,
			status: input.status,
			payload: input.payload,
			summary: input.summary,
			error: input.error,
			usage: input.usage,
			updatedAt: new Date().toISOString(),
		};
		await writeFile(filePath, JSON.stringify(record, null, 2), "utf8");
	}

	async read(login: string): Promise<CacheRecord | null> {
		try {
			const contents = await readFile(this.resolvePath(login), "utf8");
			return JSON.parse(contents) as CacheRecord;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}

	async readAll(): Promise<Map<string, CacheRecord>> {
		await this.ensureDirectory();
		const entries = new Map<string, CacheRecord>();
		const files = await readdir(this.baseDir, { withFileTypes: true });
		for (const dirent of files) {
			if (!dirent.isFile() || !dirent.name.endsWith(".summary.json")) {
				continue;
			}
			const login = dirent.name.replace(/\.summary\.json$/, "");
			const record = await this.read(login);
			if (record) {
				entries.set(login, record);
			}
		}
		return entries;
	}

	async clear(login?: string): Promise<void> {
		if (!login) {
			await this.ensureDirectory();
			const files = await readdir(this.baseDir, { withFileTypes: true });
			await Promise.all(
				files
					.filter(
						(entry) => entry.isFile() && entry.name.endsWith(".summary.json"),
					)
					.map((entry) => rm(join(this.baseDir, entry.name))),
			);
			return;
		}

		try {
			await rm(this.resolvePath(login));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return;
			}
			throw error;
		}
	}

	private async ensureDirectory(): Promise<void> {
		await mkdir(this.baseDir, { recursive: true });
	}

	private resolvePath(login: string): string {
		const safeLogin = login.replace(/[^a-z0-9.-]/gi, "_");
		return join(this.baseDir, `${safeLogin}.summary.json`);
	}
}

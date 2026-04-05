import { consola } from "consola";
import { getValidAccessToken } from "./google-oauth.js";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

export interface DriveFile {
	id: string;
	name: string;
	mimeType: string;
	modifiedTime: string;
	parents?: string[];
}

interface DriveFileListResponse {
	files: DriveFile[];
	nextPageToken?: string;
}

const logger = consola.withTag("teamhero:google-drive");

async function driveRequest(
	path: string,
	params?: Record<string, string>,
	retries = 3,
): Promise<Response> {
	const accessToken = await getValidAccessToken();
	const url = new URL(`${DRIVE_API_BASE}${path}`);
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			url.searchParams.set(key, value);
		}
	}

	for (let attempt = 0; attempt <= retries; attempt++) {
		const resp = await fetch(url.toString(), {
			headers: { Authorization: `Bearer ${accessToken}` },
		});

		if (resp.status === 429 && attempt < retries) {
			const backoff = 2 ** attempt * 1000;
			logger.debug(`Rate limited, retrying in ${backoff}ms...`);
			await new Promise((r) => setTimeout(r, backoff));
			continue;
		}

		if (!resp.ok) {
			const text = await resp.text();
			throw new Error(`Drive API ${path} failed (${resp.status}): ${text}`);
		}

		return resp;
	}

	throw new Error(`Drive API ${path} failed after ${retries} retries`);
}

/**
 * List files matching a Drive API query.
 * See https://developers.google.com/drive/api/guides/search-files
 */
export async function listFiles(
	query: string,
	fields = "files(id,name,mimeType,modifiedTime,parents)",
	pageSize = 100,
): Promise<DriveFile[]> {
	const resp = await driveRequest("/files", {
		q: query,
		fields,
		pageSize: String(pageSize),
		orderBy: "modifiedTime desc",
	});

	const data = (await resp.json()) as DriveFileListResponse;
	return data.files ?? [];
}

/**
 * Export a Google Docs document as plain text.
 * For non-Google-Docs files, use downloadFile() instead.
 */
export async function exportDocument(
	fileId: string,
	mimeType = "text/plain",
): Promise<string> {
	const resp = await driveRequest(`/files/${fileId}/export`, {
		mimeType,
	});
	return resp.text();
}

/**
 * Find a folder by name in Google Drive.
 * Returns the folder ID or null if not found.
 */
export async function findFolderByName(name: string): Promise<string | null> {
	const files = await listFiles(
		`name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
		"files(id,name)",
	);
	return files.length > 0 ? files[0].id : null;
}

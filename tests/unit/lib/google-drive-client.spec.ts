import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";

import * as googleOauthMod from "../../../src/lib/google-oauth.js";

mock.module("../../../src/lib/google-oauth.js", () => ({
	...googleOauthMod,
	getValidAccessToken: mock().mockResolvedValue("mock-token"),
}));

afterAll(() => {
	mock.restore();
});

// Use a query parameter on the import to bypass any mock.module calls from
// other test files (e.g., google-drive-adapter.spec.ts) that mock this module
// entirely. Bun treats "?real" as a distinct module specifier, so we get the
// actual implementation while the google-oauth mock still applies.
const { exportDocument, findFolderByName, listFiles } = await import(
	"../../../src/lib/google-drive-client.ts?real"
);

describe("google-drive-client", () => {
	let fetchSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		fetchSpy = spyOn(globalThis, "fetch");
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	describe("listFiles", () => {
		it("calls Drive API with correct query parameters", async () => {
			fetchSpy.mockResolvedValue(
				new Response(
					JSON.stringify({
						files: [
							{
								id: "file1",
								name: "Test Doc",
								mimeType: "application/vnd.google-apps.document",
								modifiedTime: "2026-01-29T10:00:00Z",
							},
						],
					}),
					{ status: 200 },
				),
			);

			const files = await listFiles("name = 'test'");

			expect(fetchSpy).toHaveBeenCalledWith(
				expect.stringContaining("drive/v3/files"),
				expect.objectContaining({
					headers: { Authorization: "Bearer mock-token" },
				}),
			);
			expect(files).toHaveLength(1);
			expect(files[0].name).toBe("Test Doc");
		});

		it("returns empty array when no files match", async () => {
			fetchSpy.mockResolvedValue(
				new Response(JSON.stringify({ files: [] }), { status: 200 }),
			);

			const files = await listFiles("name = 'nonexistent'");
			expect(files).toEqual([]);
		});
	});

	describe("exportDocument", () => {
		it("exports document as plain text", async () => {
			fetchSpy.mockResolvedValue(
				new Response("Exported document content", { status: 200 }),
			);

			const text = await exportDocument("doc-id-123");

			expect(text).toBe("Exported document content");
			expect(fetchSpy).toHaveBeenCalledWith(
				expect.stringContaining("files/doc-id-123/export"),
				expect.any(Object),
			);
		});
	});

	describe("findFolderByName", () => {
		it("returns folder ID when found", async () => {
			fetchSpy.mockResolvedValue(
				new Response(
					JSON.stringify({
						files: [{ id: "folder-123", name: "Meet Notes" }],
					}),
					{ status: 200 },
				),
			);

			const id = await findFolderByName("Meet Notes");
			expect(id).toBe("folder-123");
		});

		it("returns null when folder not found", async () => {
			fetchSpy.mockResolvedValue(
				new Response(JSON.stringify({ files: [] }), { status: 200 }),
			);

			const id = await findFolderByName("Nonexistent Folder");
			expect(id).toBeNull();
		});
	});

	describe("retry on 429", () => {
		it("retries with backoff on rate limit response", async () => {
			fetchSpy
				.mockResolvedValueOnce(new Response("", { status: 429 }))
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ files: [{ id: "f1", name: "Doc" }] }), {
						status: 200,
					}),
				);

			const files = await listFiles("test query");
			expect(files).toHaveLength(1);
			expect(fetchSpy).toHaveBeenCalledTimes(2);
		});
	});
});

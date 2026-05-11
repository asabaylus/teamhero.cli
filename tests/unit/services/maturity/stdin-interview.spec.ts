import { describe, expect, it } from "bun:test";
import { Readable } from "node:stream";
import {
	StdinInterviewTransport,
	StdinLineReader,
} from "../../../../src/services/maturity/stdin-interview.js";
import type { InterviewQuestion } from "../../../../src/services/maturity/types.js";

function makeStream(lines: string[]): NodeJS.ReadableStream {
	return Readable.from(lines.map((l) => `${l}\n`));
}

describe("StdinLineReader", () => {
	it("returns lines that arrive before any caller waits (no dropped lines)", async () => {
		const stream = makeStream(["alpha", "beta", "gamma"]);
		const reader = new StdinLineReader(stream);
		// Give the stream a tick to deliver data + end before reading.
		await new Promise((r) => setTimeout(r, 10));
		expect(await reader.nextLine()).toBe("alpha");
		expect(await reader.nextLine()).toBe("beta");
		expect(await reader.nextLine()).toBe("gamma");
		expect(await reader.nextLine()).toBe(""); // EOF
	});

	it("returns lines that arrive after the caller is already waiting", async () => {
		const stream = new Readable({ read() {} });
		const reader = new StdinLineReader(stream);
		const firstP = reader.nextLine();
		stream.push("hello\n");
		expect(await firstP).toBe("hello");
		const secondP = reader.nextLine();
		stream.push("world\n");
		stream.push(null);
		expect(await secondP).toBe("world");
	});

	it("handles a single chunk that contains multiple lines and EOF", async () => {
		const stream = new Readable({ read() {} });
		const reader = new StdinLineReader(stream);
		stream.push("one\ntwo\nthree\n");
		stream.push(null);
		await new Promise((r) => setTimeout(r, 10));
		expect(await reader.nextLine()).toBe("one");
		expect(await reader.nextLine()).toBe("two");
		expect(await reader.nextLine()).toBe("three");
		expect(await reader.nextLine()).toBe("");
	});

	it("handles partial-line chunks across multiple data events", async () => {
		const stream = new Readable({ read() {} });
		const reader = new StdinLineReader(stream);
		stream.push("hel");
		stream.push("lo\nwo");
		stream.push("rld\n");
		stream.push(null);
		await new Promise((r) => setTimeout(r, 10));
		expect(await reader.nextLine()).toBe("hello");
		expect(await reader.nextLine()).toBe("world");
		expect(await reader.nextLine()).toBe("");
	});
});

describe("StdinInterviewTransport", () => {
	const sampleQuestion: InterviewQuestion = {
		id: "q1",
		prompt: "test prompt",
		options: ["a", "b", "I don't know"],
		allowFreeText: true,
		configHeading: "Test (Q1)",
	};

	it("emits a question event and returns the matching answer", async () => {
		const stream = makeStream([
			'{"type":"interview-answer","questionId":"q1","value":"hello","isOption":false}',
		]);
		const reader = new StdinLineReader(stream);
		const emitted: Array<Record<string, unknown>> = [];
		const transport = new StdinInterviewTransport(reader, (e) =>
			emitted.push(e),
		);
		await new Promise((r) => setTimeout(r, 10));

		const answer = await transport.ask(sampleQuestion);
		expect(answer).toEqual({
			questionId: "q1",
			value: "hello",
			isOption: false,
		});
		expect(emitted).toHaveLength(1);
		expect(emitted[0].type).toBe("interview-question");
		expect(emitted[0].questionId).toBe("q1");
	});

	it("ignores answers that don't match the current question id", async () => {
		const stream = makeStream([
			'{"type":"interview-answer","questionId":"q5","value":"wrong","isOption":true}',
			'{"type":"interview-answer","questionId":"q1","value":"right","isOption":true}',
		]);
		const reader = new StdinLineReader(stream);
		const transport = new StdinInterviewTransport(reader, () => {});
		await new Promise((r) => setTimeout(r, 10));
		const answer = await transport.ask(sampleQuestion);
		expect(answer.value).toBe("right");
	});

	it("returns 'unknown' when the stream closes without answering", async () => {
		const stream = makeStream([]);
		const reader = new StdinLineReader(stream);
		const transport = new StdinInterviewTransport(reader, () => {});
		await new Promise((r) => setTimeout(r, 10));
		const answer = await transport.ask(sampleQuestion);
		expect(answer.value).toBe("unknown");
	});

	it("processes 7 questions in sequence with all answers buffered upfront", async () => {
		const lines = [];
		for (let i = 1; i <= 7; i++) {
			lines.push(
				JSON.stringify({
					type: "interview-answer",
					questionId: `q${i}`,
					value: `answer-${i}`,
					isOption: true,
				}),
			);
		}
		const stream = makeStream(lines);
		const reader = new StdinLineReader(stream);
		const transport = new StdinInterviewTransport(reader, () => {});
		await new Promise((r) => setTimeout(r, 10));

		const collected: string[] = [];
		for (let i = 1; i <= 7; i++) {
			const q: InterviewQuestion = {
				id: `q${i}` as InterviewQuestion["id"],
				prompt: `question ${i}`,
				options: ["x", "y"],
				allowFreeText: true,
				configHeading: `Q${i}`,
			};
			const answer = await transport.ask(q);
			collected.push(answer.value);
		}
		expect(collected).toEqual([
			"answer-1",
			"answer-2",
			"answer-3",
			"answer-4",
			"answer-5",
			"answer-6",
			"answer-7",
		]);
	});
});

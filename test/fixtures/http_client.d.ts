// Minimal fetch / Headers / Response types for GoFront tests.

interface Headers {
	get(name: string): string;
	set(name: string, value: string): void;
}

interface Response {
	ok: boolean;
	status: number;
	statusText: string;
	headers: Headers;
	text(): string;
	json(): unknown;
}

interface RequestInit {
	method: string;
	body: string;
}

declare function fetch(url: string, init: RequestInit): Response;

#!/usr/bin/env node
/**
 * chat.mjs
 *
 * Chat with xAI Grok via Responses API.
 * Supports optional image attachments.
 *
 * Examples:
 *   node {baseDir}/scripts/chat.mjs "What is xAI?"
 *   node {baseDir}/scripts/chat.mjs --model grok-4-1-fast "Summarize today's AI news"
 *   node {baseDir}/scripts/chat.mjs --image ./pic.jpg "What's in this image?"
 *   node {baseDir}/scripts/chat.mjs --json "Return a JSON object with keys a,b"
 */

import fs from "node:fs";
import path from "node:path";
import { readKeyFromEnv } from "./utils/readKeyFromEnv.mjs";

function usage(msg) {
	if (msg) console.error(msg);
	console.error(
		"Usage: chat.mjs [--model <id>] [--json] [--raw] [--image <path>]... <prompt>",
	);
	process.exit(2);
}

function mimeFor(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
	if (ext === ".png") return "image/png";
	if (ext === ".webp") return "image/webp";
	if (ext === ".gif") return "image/gif";
	return null;
}

function toDataUrl(filePath) {
	const mime = mimeFor(filePath);
	if (!mime) throw new Error(`Unsupported image type: ${filePath}`);
	const buf = fs.readFileSync(filePath);
	return `data:${mime};base64,${buf.toString("base64")}`;
}

function collectCitations(resp) {
	const out = new Set();
	if (Array.isArray(resp?.citations)) {
		for (const u of resp.citations) if (typeof u === "string" && u) out.add(u);
	}
	if (Array.isArray(resp?.output)) {
		for (const item of resp.output) {
			const content = Array.isArray(item?.content) ? item.content : [];
			for (const c of content) {
				const ann = Array.isArray(c?.annotations) ? c.annotations : [];
				for (const a of ann) {
					const url = a?.url || a?.web_citation?.url;
					if (typeof url === "string" && url) out.add(url);
				}
			}
		}
	}
	return [...out];
}

const args = process.argv.slice(2);
if (!args.length) usage();

let model = process.env.GROK_MODEL || process.env.XAI_MODEL || "grok-4-1-fast";
let jsonOut = false;
let rawOut = false;
let images = [];
let promptParts = [];
const apiBase = (process.env.XAI_BASE_URL || "https://api.x.ai/v1").replace(
	/\/+$/,
	"",
);
const timeoutMs = Math.max(
	1000,
	Number(process.env.XAI_TIMEOUT_MS || 45000) || 45000,
);
const maxRetries = Math.max(0, Number(process.env.XAI_RETRIES || 2) || 2);

for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a === "--model") {
		const v = args[++i];
		if (!v) usage("Missing value for --model");
		model = v;
	} else if (a === "--json") jsonOut = true;
	else if (a === "--raw") rawOut = true;
	else if (a === "--image") {
		const v = args[++i];
		if (!v) usage("Missing value for --image");
		images.push(v);
	} else if (a.startsWith("-")) usage(`Unknown flag: ${a}`);
	else promptParts.push(a);
}

const prompt = promptParts.join(" ").trim();
if (!prompt) usage("Missing <prompt>");

const apiKey = readKeyFromEnv();
if (!apiKey) {
	console.error("Missing XAI_API_KEY.");
	process.exit(1);
}

const content = [{ type: "input_text", text: prompt }];
for (const img of images) {
	content.push({ type: "input_image", image_url: toDataUrl(img) });
}

const body = {
	model,
	input: [{ role: "user", content }],
	tools: [
		{
			type: "web_search",
		},
		{
			type: "x_search",
		},
	],
	tool_choice: "auto",
	temperature: 0.7,
	store: false,
};

function isRetryableNetworkError(err) {
	const code = err?.cause?.code || err?.code;
	return [
		"ECONNRESET",
		"ETIMEDOUT",
		"EAI_AGAIN",
		"ENOTFOUND",
		"ECONNREFUSED",
	].includes(code);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, init, retries, perTryTimeoutMs) {
	let lastErr = null;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const signal = AbortSignal.timeout(perTryTimeoutMs);
			return await fetch(url, { ...init, signal });
		} catch (err) {
			lastErr = err;
			const timedOut =
				err?.name === "TimeoutError" || err?.name === "AbortError";
			const shouldRetry =
				attempt < retries && (timedOut || isRetryableNetworkError(err));
			if (!shouldRetry) throw err;
			await sleep(300 * (attempt + 1));
		}
	}
	throw lastErr || new Error("fetch failed");
}

let res;

try {
	res = await fetchWithRetry(
		`${apiBase}/responses`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		},
		maxRetries,
		timeoutMs,
	);
} catch (err) {
	const code = err?.cause?.code || err?.code || "UNKNOWN";
	console.error(
		`Network error calling xAI API: ${code} ${err?.message || "fetch failed"}`,
	);
	console.error(`Target: ${apiBase}/responses`);
	console.error(
		"Hint: if direct access to api.x.ai is blocked/reset in your network, use a proxy/VPN, or set XAI_BASE_URL to your reachable gateway.",
	);
	console.error(
		"Hint: for env proxy support in Node fetch, set NODE_USE_ENV_PROXY=1 and HTTPS_PROXY/HTTP_PROXY.",
	);
	process.exit(1);
}

if (!res.ok) {
	const t = await res.text().catch(() => "");
	console.error(`xAI API error: ${res.status} ${res.statusText}`);
	console.error(t.slice(0, 4000));
	process.exit(1);
}

const data = await res.json();

const text =
	data.output_text ||
	data?.output
		?.flatMap((o) => (Array.isArray(o?.content) ? o.content : []))
		?.find((c) => c?.type === "output_text" && typeof c?.text === "string")
		?.text ||
	"";

if (jsonOut) {
	console.log(
		JSON.stringify(
			{ model, prompt, text, citations: collectCitations(data) },
			null,
			2,
		),
	);
	if (rawOut) console.error(JSON.stringify(data, null, 2));
	process.exit(0);
}

console.log(text.trim());
const cites = collectCitations(data);
if (cites.length) {
	console.log("\nCitations:");
	for (const c of cites) console.log(`- ${c}`);
}

if (rawOut) {
	console.error("\n--- RAW RESPONSE (debug) ---\n");
	console.error(JSON.stringify(data, null, 2));
}

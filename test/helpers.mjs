/**
 * Shared tooling for the LanguageTool client tests.
 *
 * The fixtures are real server responses, described by `fixtures/cases.json`.
 * The tests read that same manifest to find the exact text that was sent,
 * otherwise the text would be declared in two places and the offsets would no
 * longer mean anything.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
/** Single source of truth for the texts, the parameters and the server. */
export const manifest = JSON.parse(readFileSync(join(fixturesDir, "cases.json"), "utf8"));

/**
 * Loads a captured case: the text sent, the parameters, the body received.
 *
 * @param {string} file File name as it appears in cases.json.
 */
export function loadCase(file) {
    const entry = manifest.cases.find((candidate) => candidate.file === file);
    if (entry === undefined) {
        throw new Error(`case missing from cases.json: ${file}`);
    }
    const body = readFileSync(join(fixturesDir, file), "utf8");
    return {
        text: entry.text,
        params: entry.params,
        status: entry.status ?? 200,
        body,
        json: file.endsWith(".json") ? JSON.parse(body) : undefined,
    };
}

/** Minimal valid configuration, to override case by case. */
export function config(overrides = {}) {
    return { url: "https://lt.example/v2", ...overrides };
}

/**
 * Replaces `fetch` with a recorder, and restores it when the test ends.
 *
 * @param {object} t node:test test context.
 * @param {Response|function(string, object): Response} reply
 * @returns {Array<{url: string, options: object, body: string, params: URLSearchParams}>}
 */
export function stubFetch(t, reply) {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
        const body = options.body === undefined ? "" : String(options.body);
        calls.push({ url, options, body, params: new URLSearchParams(body) });
        return typeof reply === "function" ? reply(url, options) : reply;
    };
    t.after(() => {
        globalThis.fetch = original;
    });
    return calls;
}

/** JSON response, as the server returns it on success. */
export function jsonReply(body, status = 200) {
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

/** LanguageTool error response: plain text, not JSON. */
export function textReply(body, status) {
    return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

/**
 * A `stubFetch` reply that arrives after a delay, and that honors abort.
 *
 * A time budget is only proved against a server that takes its time, and a stub
 * deaf to the abort signal would hang the test instead of failing it. `reply` is
 * taken as a function when the same stub answers twice, because a `Response` can
 * only be read once.
 *
 * @param {Response|function(): Response} reply
 * @param {number} delayMs
 */
export function delayedReply(reply, delayMs) {
    return (url, options = {}) => new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => resolve(typeof reply === "function" ? reply() : reply),
            delayMs,
        );
        options.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(options.signal.reason);
        });
    });
}

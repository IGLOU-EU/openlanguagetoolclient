/**
 * The time budget.
 *
 * `fetch` has no default timeout. Without a bound, a connection that drops
 * leaves the promise unresolved forever, and the extension would sit
 * indefinitely on "check in progress". Exceeding the timeout is classed as
 * `unreachable`: for someone writing a message, a silent server and an
 * unreachable server are the same thing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../src/languagetool.js";
import { config, delayedReply, jsonReply, loadCase, stubFetch } from "./helpers.mjs";

const clean = loadCase("fr-clean.json");

/** A server that takes that long to answer a text without a mistake in it. */
function slowFetch(delayMs) {
    return delayedReply(() => jsonReply(clean.body), delayMs);
}

test("an exceeded timeout gives unreachable, and the detail names it", async (t) => {
    stubFetch(t, slowFetch(5000));

    const result = await check("Bonjour.", config({ language: "fr", timeoutMs: 20 }));

    assert.deepEqual(result.matches, []);
    assert.equal(result.detectedLanguage, null);
    assert.equal(result.failure.kind, "unreachable");
    assert.equal(result.failure.detail, "timeout of 20 ms exceeded");
});

test("an exceeded timeout does not make check() throw", async (t) => {
    stubFetch(t, slowFetch(5000));

    // Not throwing is the central guarantee: an await that returns a value is
    // enough to prove it.
    const result = await check("Bonjour.", config({ language: "fr", timeoutMs: 10 }));

    assert.deepEqual(Object.keys(result).sort(), [
        "confidence",
        "detectedLanguage",
        "failure",
        "matches",
    ]);
});

test("a slow response within the time budget still passes", async (t) => {
    stubFetch(t, slowFetch(20));

    const result = await check(clean.text, config({ language: "fr", timeoutMs: 1000 }));

    assert.equal(result.failure, null);
    assert.deepEqual(result.matches, []);
    assert.equal(result.detectedLanguage, "fr");
});

test("without timeoutMs, the default timeout lets a slow response through", async (t) => {
    stubFetch(t, slowFetch(50));

    const result = await check(clean.text, config({ language: "fr" }));

    assert.equal(result.failure, null);
    assert.equal(result.detectedLanguage, "fr");
});

test("an abort signal is passed to fetch, not triggered at the start", async (t) => {
    const calls = stubFetch(t, jsonReply(clean.body));

    await check("Bonjour.", config({ language: "fr" }));

    const { signal } = calls[0].options;
    assert.ok(signal instanceof AbortSignal);
    assert.equal(signal.aborted, false);
});

test("a numeric timeoutMs given as a string is honored", async (t) => {
    // An options page that stores input.value yields a string.
    stubFetch(t, slowFetch(5000));

    const result = await check("Bonjour.", config({ language: "fr", timeoutMs: "20" }));

    assert.equal(result.failure.kind, "unreachable");
    assert.equal(result.failure.detail, "timeout of 20 ms exceeded");
});

for (const [label, timeoutMs] of [
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
    ["text", "right now"],
    ["null", null],
    ["object", {}],
]) {
    test(`an absurd timeoutMs (${label}) falls back to the default`, async (t) => {
        // An unusable value must not doom every check.
        stubFetch(t, slowFetch(30));

        const result = await check(clean.text, config({ language: "fr", timeoutMs }));

        assert.equal(result.failure, null);
        assert.equal(result.detectedLanguage, "fr");
    });
}

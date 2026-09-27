/**
 * The contract of `languages()` in src/languagetool.js: the list the options
 * page fills its language menus from.
 *
 * Like `check()`, it never throws. An options page that cannot reach the server
 * must still let the address be corrected and saved, so a failure is reported
 * through `failure` and the list comes back empty.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { languages } from "../src/languagetool.js";
import { config, delayedReply, jsonReply, stubFetch, textReply } from "./helpers.mjs";

/**
 * The shape the server answers /languages with, written here and not captured:
 * a fixture is a real server answer, and this file has no business inventing
 * one under test/fixtures.
 */
const SERVER_LIST = [
    { name: "English (US)", code: "en", longCode: "en-US" },
    { name: "French", code: "fr", longCode: "fr" },
    { name: "French (Canada)", code: "fr", longCode: "fr-CA" },
    { name: "German (Germany)", code: "de", longCode: "de-DE" },
];

/** The keys an entry carries, sorted the way Object.keys gives them back. */
const ENTRY_KEYS = ["code", "longCode", "name"];

/** The keys a result carries, sorted the same way. */
const RESULT_KEYS = ["failure", "languages"];

/** The four kinds a failure may be, and no fifth. */
const KINDS = ["unreachable", "auth", "quota", "malformed"];

/** A failure always yields an empty list, never a partial one. */
function assertSilentFailure(result, kind) {
    assert.deepEqual(result.languages, []);
    assert.notEqual(result.failure, null);
    assert.equal(result.failure.kind, kind);
    assert.equal(typeof result.failure.detail, "string");
    assert.notEqual(result.failure.detail, "");
}

/** A fresh answer every call: a Response can only be read once. */
function listReply() {
    return jsonReply(SERVER_LIST);
}

test("asks <url>/languages", async (t) => {
    const calls = stubFetch(t, listReply());

    await languages(config());

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://lt.example/v2/languages");
});

test("asks with a GET and sends no body", async (t) => {
    const calls = stubFetch(t, listReply());

    await languages(config());

    // fetch sends a GET when no method is given, so an absent method is a GET.
    const { method } = calls[0].options;
    assert.ok(method === undefined || method.toUpperCase() === "GET", String(method));
    assert.equal(calls[0].options.body, undefined);
});

test("tolerates a server URL ending with slashes", async (t) => {
    const calls = stubFetch(t, listReply());

    await languages(config({ url: "https://lt.example/v2///" }));

    assert.equal(calls[0].url, "https://lt.example/v2/languages");
});

test("no credential is sent: no Authorization header, no username, no apiKey", async (t) => {
    const calls = stubFetch(t, listReply());

    await languages(config());

    assert.equal(calls[0].options.headers?.Authorization, undefined);
    assert.equal(calls[0].url.includes("username"), false);
    assert.equal(calls[0].url.includes("apiKey"), false);
});

test("a real looking list comes back as name, code and longCode", async (t) => {
    stubFetch(t, listReply());

    const result = await languages(config());

    assert.equal(result.failure, null);
    assert.deepEqual(result.languages, SERVER_LIST);
});

test("an entry carries only the contract fields", async (t) => {
    stubFetch(t, jsonReply([
        { name: "French", code: "fr", longCode: "fr", extra: "ignored" },
    ]));

    const result = await languages(config());

    assert.deepEqual(Object.keys(result.languages[0]).sort(), ENTRY_KEYS);
});

test("a successful result carries only the contract fields", async (t) => {
    stubFetch(t, listReply());

    const result = await languages(config());

    assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
});

test("an empty list is an answer, not a failure", async (t) => {
    // A server that speaks but knows no language is still a reachable server,
    // and the options page has to say so rather than blame the address.
    stubFetch(t, jsonReply([]));

    const result = await languages(config());

    assert.deepEqual(result.languages, []);
    assert.equal(result.failure, null);
});

for (const [label, entry] of [
    ["no name", { code: "fr", longCode: "fr" }],
    ["no code", { name: "French", longCode: "fr" }],
    ["no longCode", { name: "French", code: "fr" }],
    ["a name that is not a string", { name: 42, code: "fr", longCode: "fr" }],
    ["a code that is not a string", { name: "French", code: null, longCode: "fr" }],
    ["a longCode that is not a string", { name: "French", code: "fr", longCode: ["fr"] }],
    ["an empty object", {}],
    ["null", null],
    ["a string", "French"],
    ["a number", 42],
    ["an array", []],
]) {
    test(`an entry with ${label} is dropped, the usable ones stand`, async (t) => {
        // A menu is built from what came back, and one unusable row is no reason
        // to leave the options page with no menu at all.
        stubFetch(t, jsonReply([entry, ...SERVER_LIST]));

        const result = await languages(config());

        assert.equal(result.failure, null);
        assert.deepEqual(result.languages, SERVER_LIST);
    });
}

test("a list of nothing usable comes back empty, and not as a failure", async (t) => {
    stubFetch(t, jsonReply([{}, null, 42, "French", { name: "French" }]));

    const result = await languages(config());

    assert.deepEqual(result.languages, []);
    assert.equal(result.failure, null);
});

for (const [label, body] of [
    ["an object wrapping the list", { languages: SERVER_LIST }],
    ["an empty object", {}],
    ["null", "null"],
    ["a string", '"fr"'],
    ["a number", "42"],
    ["a boolean", "true"],
]) {
    test(`a response that is not an array (${label}): malformed`, async (t) => {
        stubFetch(t, jsonReply(body));

        const result = await languages(config());

        assertSilentFailure(result, "malformed");
    });
}

test("a 200 response that is not JSON: malformed", async (t) => {
    stubFetch(t, textReply("<html><title>Authentication portal</title></html>", 200));

    const result = await languages(config());

    assertSilentFailure(result, "malformed");
});

test("an empty 200 response: malformed", async (t) => {
    stubFetch(t, textReply("", 200));

    const result = await languages(config());

    assertSilentFailure(result, "malformed");
});

test("status 403: auth", async (t) => {
    stubFetch(t, textReply("Error: forbidden", 403));

    const result = await languages(config());

    assertSilentFailure(result, "auth");
    assert.match(result.failure.detail, /403/);
});

test("status 401: auth", async (t) => {
    stubFetch(t, textReply("Error: unauthorized", 401));

    const result = await languages(config());

    assertSilentFailure(result, "auth");
    assert.match(result.failure.detail, /401/);
});

test("status 429: quota", async (t) => {
    stubFetch(t, textReply("Error: too many requests", 429));

    const result = await languages(config());

    assertSilentFailure(result, "quota");
    assert.match(result.failure.detail, /429/);
});

for (const status of [500, 502, 503, 504]) {
    test(`status ${status}: unreachable, the service is out of reach`, async (t) => {
        stubFetch(t, textReply("<html><body>Bad Gateway</body></html>", status));

        const result = await languages(config());

        assertSilentFailure(result, "unreachable");
        assert.match(result.failure.detail, new RegExp(String(status)));
    });
}

test("no refused status makes languages() report a fifth kind", async (t) => {
    // The kinds are a closed set: the options page has one sentence per kind and
    // nothing to say about a kind it has never heard of.
    for (const status of [400, 404, 405, 418, 451, 501]) {
        const restore = globalThis.fetch;
        globalThis.fetch = async () => textReply(`Error ${status}`, status);
        try {
            const result = await languages(config());

            assert.deepEqual(result.languages, []);
            assert.ok(KINDS.includes(result.failure?.kind), `status ${status}`);
        } finally {
            globalThis.fetch = restore;
        }
    }
});

test("the error detail is truncated, the server may answer at great length", async (t) => {
    stubFetch(t, textReply(`Error: ${"x".repeat(5000)}`, 400));

    const result = await languages(config());

    assert.ok(result.failure.detail.length < 500, result.failure.detail.length);
});

test("unreachable server: unreachable", async (t) => {
    stubFetch(t, () => {
        throw new TypeError("NetworkError when attempting to fetch resource.");
    });

    const result = await languages(config());

    assertSilentFailure(result, "unreachable");
    assert.match(result.failure.detail, /NetworkError/);
});

test("fetch rejects asynchronously: unreachable", async (t) => {
    stubFetch(t, () => Promise.reject(new Error("getaddrinfo ENOTFOUND")));

    const result = await languages(config());

    assertSilentFailure(result, "unreachable");
});

test("the cause of the network failure is reported in the detail", async (t) => {
    // A private server behind its own certificate authority is the first thing
    // this list fails on, and the page has to be able to say which it was.
    stubFetch(t, () => {
        throw new TypeError("fetch failed", {
            cause: new Error("self-signed certificate in certificate chain"),
        });
    });

    const result = await languages(config());

    assertSilentFailure(result, "unreachable");
    assert.match(result.failure.detail, /self-signed certificate/);
});

test("an exceeded timeout gives unreachable, and the detail names it", async (t) => {
    stubFetch(t, delayedReply(listReply, 5000));

    const result = await languages(config({ timeoutMs: 20 }));

    assertSilentFailure(result, "unreachable");
    assert.equal(result.failure.detail, "timeout of 20 ms exceeded");
});

test("an exceeded timeout does not make languages() throw", async (t) => {
    stubFetch(t, delayedReply(listReply, 5000));

    const result = await languages(config({ timeoutMs: 10 }));

    assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
});

test("a slow answer within the time budget still passes", async (t) => {
    stubFetch(t, delayedReply(listReply, 20));

    const result = await languages(config({ timeoutMs: 1000 }));

    assert.equal(result.failure, null);
    assert.deepEqual(result.languages, SERVER_LIST);
});

test("without timeoutMs, the default budget lets a slow answer through", async (t) => {
    stubFetch(t, delayedReply(listReply, 50));

    const result = await languages(config());

    assert.equal(result.failure, null);
    assert.deepEqual(result.languages, SERVER_LIST);
});

test("a numeric timeoutMs given as a string is honored", async (t) => {
    // An options page that stores input.value yields a string.
    stubFetch(t, delayedReply(listReply, 5000));

    const result = await languages(config({ timeoutMs: "20" }));

    assertSilentFailure(result, "unreachable");
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
        // An unusable value must not doom the one request the options page makes.
        stubFetch(t, delayedReply(listReply, 30));

        const result = await languages(config({ timeoutMs }));

        assert.equal(result.failure, null);
        assert.deepEqual(result.languages, SERVER_LIST);
    });
}

test("an abort signal is passed to fetch, not triggered at the start", async (t) => {
    const calls = stubFetch(t, listReply());

    await languages(config());

    const { signal } = calls[0].options;
    assert.ok(signal instanceof AbortSignal);
    assert.equal(signal.aborted, false);
});

test("no hostile answer makes languages() throw", async (t) => {
    const hostile = [
        () => {
            throw new Error("boom");
        },
        () => Promise.reject(new Error("boom")),
        () => undefined,
        () => null,
        () => ({}),
        () => textReply("", 200),
        () => textReply("not json", 200),
        () => jsonReply({}),
        () => jsonReply([{}]),
        () => textReply("Error: quota", 429),
        () => textReply("Error: auth", 401),
        () => textReply("Error: server", 500),
        () => new Response("[]", { status: 204 }),
        () => ({
            ok: true,
            status: 200,
            text: () => {
                throw new Error("connection dropped while reading");
            },
        }),
    ];

    for (const reply of hostile) {
        const restore = globalThis.fetch;
        globalThis.fetch = async () => reply();
        try {
            const result = await languages(config());

            assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
            assert.ok(Array.isArray(result.languages));
            if (result.failure !== null) {
                assert.ok(KINDS.includes(result.failure.kind), result.failure.kind);
            }
        } finally {
            globalThis.fetch = restore;
        }
    }
});

test("a missing configuration does not make languages() throw", async (t) => {
    stubFetch(t, () => listReply());

    for (const broken of [undefined, null, {}, { url: 42 }, { url: "" }]) {
        const result = await languages(broken);

        assert.deepEqual(
            Object.keys(result).sort(),
            RESULT_KEYS,
            `configuration: ${JSON.stringify(broken)}`,
        );
    }
});

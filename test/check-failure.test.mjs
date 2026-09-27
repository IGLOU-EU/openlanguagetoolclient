/**
 * Failures. `check()` never throws: the extension must never prevent writing
 * or sending a message.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../src/languagetool.js";
import { config, jsonReply, loadCase, stubFetch, textReply } from "./helpers.mjs";

/** A failure always yields an empty result, never partial matches. */
function assertSilentFailure(result, kind) {
    assert.deepEqual(result.matches, []);
    assert.equal(result.detectedLanguage, null);
    // A refused response is no measurement: a confidence read out of it would
    // hand the caller a language to impose on the strength of nothing.
    assert.equal(result.confidence, null);
    assert.notEqual(result.failure, null);
    assert.equal(result.failure.kind, kind);
    assert.equal(typeof result.failure.detail, "string");
    assert.notEqual(result.failure.detail, "");
}

test("unreachable server: unreachable", async (t) => {
    stubFetch(t, () => {
        throw new TypeError("NetworkError when attempting to fetch resource.");
    });

    const result = await check("Bonjour.", config({ language: "fr" }));

    assertSilentFailure(result, "unreachable");
    assert.match(result.failure.detail, /NetworkError/);
});

test("fetch rejects asynchronously: unreachable", async (t) => {
    stubFetch(t, () => Promise.reject(new Error("getaddrinfo ENOTFOUND")));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assertSilentFailure(result, "unreachable");
});

test("the cause of the network failure is reported in the detail", async (t) => {
    // Without it, a refused certificate, a silent DNS and a closed port all
    // three give "TypeError: fetch failed".
    stubFetch(t, () => {
        throw new TypeError("fetch failed", {
            cause: new Error("self-signed certificate in certificate chain"),
        });
    });

    const result = await check("Bonjour.", config({ language: "fr" }));

    assertSilentFailure(result, "unreachable");
    assert.match(result.failure.detail, /self-signed certificate/);
});

test("an error without cause stays readable", async (t) => {
    stubFetch(t, () => {
        throw new TypeError("NetworkError when attempting to fetch resource.");
    });

    const result = await check("Bonjour.", config({ language: "fr" }));

    assertSilentFailure(result, "unreachable");
    assert.equal(
        result.failure.detail,
        "TypeError: NetworkError when attempting to fetch resource.",
    );
});

test("invalid server URL: unreachable, no throw", async (t) => {
    stubFetch(t, () => {
        throw new TypeError("Failed to parse URL");
    });

    const result = await check("Bonjour.", config({ url: undefined }));

    assertSilentFailure(result, "unreachable");
});

test("status 429: quota", async (t) => {
    stubFetch(t, textReply("Error: too many requests", 429));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assertSilentFailure(result, "quota");
    assert.match(result.failure.detail, /429/);
});

test("status 401: auth", async (t) => {
    stubFetch(t, textReply("Error: unauthorized", 401));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assertSilentFailure(result, "auth");
    assert.match(result.failure.detail, /401/);
});

test("status 403 from the real server: auth, with the server message", async (t) => {
    // Real response, obtained with curl using username and apiKey, see cases.json.
    const fixture = loadCase("error-403-auth.txt");
    assert.equal(fixture.status, 403);
    stubFetch(t, textReply(fixture.body, 403));

    const result = await check(fixture.text, config({ language: "fr" }));

    assertSilentFailure(result, "auth");
    assert.match(result.failure.detail, /403/);
    assert.match(result.failure.detail, /AuthException/);
});

test("status 400 from the real server: malformed", async (t) => {
    const fixture = loadCase("error-400-preferred-variants.txt");
    stubFetch(t, textReply(fixture.body, 400));

    const result = await check(fixture.text, config({ language: "fr" }));

    assertSilentFailure(result, "malformed");
    assert.match(result.failure.detail, /400/);
});

for (const status of [500, 502, 503, 504]) {
    test(`status ${status}: unreachable, the service is out of reach`, async (t) => {
        stubFetch(t, textReply("<html><body>Bad Gateway</body></html>", status));

        const result = await check("Bonjour.", config({ language: "fr" }));

        assertSilentFailure(result, "unreachable");
        assert.match(result.failure.detail, new RegExp(String(status)));
    });
}

test("the error detail is truncated, the server may answer at great length", async (t) => {
    stubFetch(t, textReply(`Error: ${"x".repeat(5000)}`, 400));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assertSilentFailure(result, "malformed");
    assert.ok(result.failure.detail.length < 500, result.failure.detail.length);
});

test("a 200 response that is not JSON: malformed", async (t) => {
    stubFetch(t, textReply("<html><title>Authentication portal</title></html>", 200));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assertSilentFailure(result, "malformed");
});

test("an empty 200 response: malformed", async (t) => {
    stubFetch(t, textReply("", 200));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assertSilentFailure(result, "malformed");
});

for (const [label, body] of [
    ["no matches field", { language: { code: "fr" } }],
    ["matches that is not an array", { matches: "none" }],
    ["null matches", { matches: null }],
    ["JSON that is an array", []],
    ["JSON that is a string", '"hello"'],
    ["JSON that is null", "null"],
    ["missing offset", { matches: [{ length: 2 }] }],
    ["non-numeric offset", { matches: [{ offset: "15", length: 2 }] }],
    ["missing length", { matches: [{ offset: 15 }] }],
    ["infinite offset", { matches: [{ offset: Number.MAX_VALUE * 2, length: 2 }] }],
]) {
    test(`unusable 200 response (${label}): malformed`, async (t) => {
        stubFetch(t, jsonReply(body));

        const result = await check("Bonjour.", config({ language: "fr" }));

        assertSilentFailure(result, "malformed");
    });
}

test("a response carrying a confidence still reports none once it is refused", async (t) => {
    // The language block is perfectly readable here, the matches are not. A
    // partial reading would let a refused answer decide the language.
    stubFetch(t, jsonReply({
        language: { code: "fr", detectedLanguage: { code: "fr", confidence: 0.99 } },
        matches: [{ offset: "15", length: 2 }],
    }));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assertSilentFailure(result, "malformed");
});

test("no hostile response makes check() throw", async (t) => {
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
        () => jsonReply({ matches: [{}] }),
        () => textReply("Error: quota", 429),
        () => textReply("Error: auth", 401),
        () => textReply("Error: server", 500),
        () => new Response("{}", { status: 204 }),
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
            const result = await check("Bonjour.", config({ language: "fr" }));
            assert.deepEqual(result.matches, []);
            assert.equal(result.confidence, null);
            assert.notEqual(result.failure, null);
            assert.ok(
                ["unreachable", "auth", "quota", "malformed"].includes(result.failure.kind),
                `unexpected kind: ${result.failure.kind}`,
            );
        } finally {
            globalThis.fetch = restore;
        }
    }
});

test("a missing configuration does not make check() throw", async (t) => {
    stubFetch(t, jsonReply(loadCase("fr-clean.json").body));

    for (const broken of [undefined, null, {}, { url: 42 }, { url: "" }]) {
        const result = await check("Bonjour.", broken);

        assert.deepEqual(
            Object.keys(result).sort(),
            ["confidence", "detectedLanguage", "failure", "matches"],
            `configuration: ${JSON.stringify(broken)}`,
        );
    }
});

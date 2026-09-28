/** What goes on the wire: URL, encoding, parameters, and the absence of credentials. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../src/languagetool.js";
import { config, jsonReply, loadCase, stubFetch } from "./helpers.mjs";

const clean = loadCase("fr-clean.json");

function ok() {
    return jsonReply(clean.body);
}

test("posts to <url>/check as a urlencoded form", async (t) => {
    const calls = stubFetch(t, ok());

    await check("Bonjour tout le monde.", config());

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://lt.example/v2/check");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(
        calls[0].options.headers["Content-Type"],
        "application/x-www-form-urlencoded",
    );
});

test("tolerates a server URL ending with slashes", async (t) => {
    const calls = stubFetch(t, ok());

    await check("Bonjour.", config({ url: "https://lt.example/v2///" }));

    assert.equal(calls[0].url, "https://lt.example/v2/check");
});

test("passes the text as is, emoji outside the basic plane included", async (t) => {
    const emoji = loadCase("emoji-offsets.json");
    const calls = stubFetch(t, ok());

    await check(emoji.text, config({ language: "fr" }));

    assert.equal(calls[0].params.get("text"), emoji.text);
});

test("language defaults to auto", async (t) => {
    const calls = stubFetch(t, ok());

    await check("Bonjour.", config());

    assert.equal(calls[0].params.get("language"), "auto");
});

test("language passes the configured code", async (t) => {
    const calls = stubFetch(t, ok());

    await check("Bonjour.", config({ language: "fr-FR" }));

    assert.equal(calls[0].params.get("language"), "fr-FR");
});

test("motherTongue is sent when configured", async (t) => {
    const calls = stubFetch(t, ok());

    await check("Bonjour.", config({ language: "fr", motherTongue: "fr" }));

    assert.equal(calls[0].params.get("motherTongue"), "fr");
});

test("motherTongue is absent when not configured", async (t) => {
    const calls = stubFetch(t, ok());

    await check("Bonjour.", config({ language: "fr" }));

    assert.equal(calls[0].params.has("motherTongue"), false);
});

test("preferredVariants goes as a comma-separated list", async (t) => {
    const calls = stubFetch(t, ok());

    await check("Bonjour.", config({
        language: "auto",
        preferredVariants: ["fr-FR", "en-US"],
    }));

    assert.equal(calls[0].params.get("preferredVariants"), "fr-FR,en-US");
});

test("preferredVariants is omitted when the language is not auto", async (t) => {
    // The server answers 400 in that case, see error-400-preferred-variants.txt.
    const refusal = loadCase("error-400-preferred-variants.txt");
    assert.match(refusal.body, /you didn't specify 'language=auto'/);

    const calls = stubFetch(t, ok());

    await check("Bonjour.", config({ language: "fr", preferredVariants: ["fr-FR"] }));

    assert.equal(calls[0].params.has("preferredVariants"), false);
});

test("an empty preferredVariants adds no parameter", async (t) => {
    const calls = stubFetch(t, ok());

    await check("Bonjour.", config({ language: "auto", preferredVariants: [] }));

    assert.equal(calls[0].params.has("preferredVariants"), false);
});

test("picky sends level=picky", async (t) => {
    const calls = stubFetch(t, ok());

    await check("Bonjour.", config({ language: "fr", picky: true }));

    assert.equal(calls[0].params.get("level"), "picky");
});

test("without picky, no level is sent", async (t) => {
    const calls = stubFetch(t, ok());

    await check("Bonjour.", config({ language: "fr", picky: false }));

    assert.equal(calls[0].params.has("level"), false);
});

test("no credential is sent: no Authorization header, no username, no apiKey", async (t) => {
    const calls = stubFetch(t, ok());

    await check("Bonjour.", config({ language: "fr" }));

    assert.equal(calls[0].options.headers.Authorization, undefined);
    assert.equal(calls[0].params.has("username"), false);
    assert.equal(calls[0].params.has("apiKey"), false);
});

for (const [label, text] of [
    ["empty string", ""],
    ["spaces", "   "],
    ["spaces and line breaks", " \n\t\r\n "],
    ["non-breaking spaces", "  "],
]) {
    test(`text without content (${label}): no request is sent`, async (t) => {
        const calls = stubFetch(t, ok());

        const result = await check(text, config({ language: "fr" }));

        assert.equal(calls.length, 0);
        assert.deepEqual(result, {
            matches: [],
            detectedLanguage: null,
            confidence: null,
            failure: null,
        });
    });
}

for (const [label, text] of [
    ["undefined", undefined],
    ["null", null],
    ["number", 42],
    ["object", {}],
]) {
    test(`text that is not a string (${label}): no request, no throw`, async (t) => {
        const calls = stubFetch(t, ok());

        const result = await check(text, config({ language: "fr" }));

        assert.equal(calls.length, 0);
        assert.equal(result.failure, null);
        assert.deepEqual(result.matches, []);
    });
}

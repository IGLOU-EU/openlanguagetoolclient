/**
 * End-to-end check against a real server.
 *
 * The other tests replace `fetch`: they therefore do not prove that the
 * request shape actually goes over the wire. These cases fill that gap, and
 * are skipped by default because they need the network.
 *
 *   LT_LIVE=1 NODE_TLS_REJECT_UNAUTHORIZED=0 npm test
 *
 * Disabling TLS verification is not in the code: the development server's
 * certificate comes from a private authority, and it is up to the operator to
 * own that workaround, not to the client.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../src/languagetool.js";
import { loadCase, manifest } from "./helpers.mjs";

const url = process.env.LT_SERVER ?? manifest.server;
const skip = process.env.LT_LIVE === "1" ? false : "set LT_LIVE=1 to query the server";

for (const entry of manifest.cases.filter((candidate) => candidate.file.endsWith(".json"))) {
    test(`real server: ${entry.file}`, { skip }, async () => {
        const fixture = loadCase(entry.file);
        const result = await check(fixture.text, { url, language: fixture.params.language });

        assert.equal(result.failure, null);
        assert.equal(result.detectedLanguage, fixture.json.language.detectedLanguage.code);
        assert.deepEqual(
            result.matches.map((match) => [match.offset, match.length, match.ruleId]),
            fixture.json.matches.map((match) => [match.offset, match.length, match.rule.id]),
        );
    });
}

test("real server: every optional parameter is accepted", { skip }, async () => {
    const result = await check("Je voudrais un cafe.", {
        url,
        language: "auto",
        motherTongue: "fr",
        preferredVariants: ["fr-FR", "en-US"],
        picky: true,
    });

    // Nothing is asserted about what came back: what this proves is that the
    // server takes the whole set at once instead of answering 400.
    assert.equal(result.failure, null);
});

test("real server: a nonexistent host gives unreachable", { skip }, async () => {
    const result = await check("Bonjour.", { url: "https://nonexistent.host.invalid/v2" });

    assert.equal(result.failure.kind, "unreachable");
    assert.match(result.failure.detail, /ENOTFOUND|EAI_AGAIN/);
});

test("real server: a timeout of one millisecond abandons the connection", { skip }, async () => {
    // The fetch stand-in cannot prove that the signal acts on a real socket.
    // One millisecond is below the smallest round trip.
    const result = await check("Il a manger une pomme.", { url, language: "fr", timeoutMs: 1 });

    assert.equal(result.failure.kind, "unreachable");
    assert.equal(result.failure.detail, "timeout of 1 ms exceeded");
});

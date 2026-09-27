/**
 * Frozen finding on offsets, verified against LanguageTool 6.6.
 *
 * The whole conversion into Ranges depends on it: if the server counted in
 * code points or in bytes, every highlight placed after an emoji would be
 * shifted. The finding is therefore frozen here, and the fixture comes from
 * the real server.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../src/languagetool.js";
import { config, jsonReply, loadCase, stubFetch } from "./helpers.mjs";

const fixture = loadCase("emoji-offsets.json");
const FAULTY_SEGMENT = "manger";

test("the reference text does contain surrogate pairs", () => {
    assert.equal(fixture.text, "Bonjour 👍🙂🎉 à Noël, il a manger une pomme.");
    assert.equal(fixture.text.length, 45);
    assert.equal([...fixture.text].length, 42);
    assert.equal(Buffer.byteLength(fixture.text, "utf8"), 53);
});

test("server offsets are in UTF-16 code units", () => {
    const [match] = fixture.json.matches;

    assert.equal(match.offset, fixture.text.indexOf(FAULTY_SEGMENT));
    assert.equal(match.offset, 28);
    assert.equal(match.length, FAULTY_SEGMENT.length);
});

test("they are neither code points nor UTF-8 bytes", () => {
    const [match] = fixture.json.matches;

    const codePointIndex = [...fixture.text.slice(0, match.offset)].length;
    const byteIndex = Buffer.byteLength(fixture.text.slice(0, match.offset), "utf8");

    assert.equal(codePointIndex, 25);
    assert.equal(byteIndex, 36);
    assert.notEqual(match.offset, codePointIndex);
    assert.notEqual(match.offset, byteIndex);
});

test("slice(offset, offset + length) lands on the faulty segment", async (t) => {
    stubFetch(t, jsonReply(fixture.body));

    const result = await check(fixture.text, config({ language: "fr" }));

    assert.equal(result.matches.length, 1);
    const [match] = result.matches;
    assert.equal(fixture.text.slice(match.offset, match.offset + match.length), FAULTY_SEGMENT);
});

test("the finding holds for every captured fixture", () => {
    const expectations = [
        ["fr-errors.json", ["cafe", "manger"]],
        ["auto-english.json", ["a", "errror"]],
        ["emoji-offsets.json", ["manger"]],
    ];

    for (const [file, segments] of expectations) {
        const captured = loadCase(file);
        const sliced = captured.json.matches.map(
            (match) => captured.text.slice(match.offset, match.offset + match.length),
        );
        assert.deepEqual(sliced, segments, file);
    }
});

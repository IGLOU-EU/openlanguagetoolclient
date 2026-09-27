/**
 * The contract of the chunking in src/body-text.js: while the language is not
 * known, the whole written text goes out at once, cut into pieces the server
 * accepts, and one answer is filed back paragraph by paragraph.
 *
 * Why it exists, measured against the real server: it detects the language from
 * what it is given, and on a lone short paragraph it gets it wrong, then
 * corrects with that language's rules. It also refuses a text past a size
 * outright, so the whole text cannot leave in one piece either.
 *
 * Everything here turns on one property: a part's offset inside its chunk, and
 * the shift `splitMatches` undoes with it. An offset off by one files an error
 * under the wrong paragraph, and the cache keeps it for the rest of the session.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    assertSpans, block, blocksOf, el, keysOf, match, matchesOf, olcBody, text, textsOf,
} from "./compose-helpers.mjs";

const {
    flatten, splitBlocks, chunkBlocks, splitMatches, missingBlocks, matchesForBlocks,
} = olcBody;

/**
 * A part as chunkBlocks returns it.
 *
 * Same shape as a block, another meaning: `start` is the offset inside the
 * chunk, not inside the whole text. Written here so that a splitMatches test
 * proves its own function and not the chunking.
 */
const part = (content, start = 0) => ({ text: content, start });

// The API under test lives in the loader's vm realm, so the arrays and objects
// it builds never match the prototypes a strict deep equality compares. These
// read the values back into host ones.
const partsOf = (parts) =>
    Array.from(parts, (found) => ({ text: found.text, start: found.start }));
const chunksOf = (chunks) =>
    Array.from(chunks, (found) => ({ text: found.text, parts: partsOf(found.parts) }));
const splitOf = (split) =>
    Array.from(split, (entry) => ({ text: entry.text, matches: matchesOf(entry.matches) }));

/** Bodies whose shape the properties below must hold for, whatever the limit. */
const shapes = [
    ["a single paragraph", "Hello world.\n"],
    ["three short paragraphs", "One.\nTwo.\nThree.\n"],
    ["a blank line between two", "First.\n\nSecond.\n"],
    ["accents and emoji", "Une phrase accentuée : déjà vu.\nDeux \u{1f600} emoji \u{1f600}.\n"],
    ["a paragraph padded with spaces", "  Indented line.  \nNext.\n"],
    ["a long paragraph among short ones", `Short.\n${"long ".repeat(20)}\nShort again.\n`],
];

/** Limits from absurd to comfortable, straddling every paragraph length above. */
const limits = [0, 1, 4, 5, 6, 7, 16, 20, 74, 200];

/** Runs one property over every shape and every limit, and says which failed. */
const forEveryShape = (assertion) => {
    for (const [label, whole] of shapes) {
        const blocks = splitBlocks(whole);
        for (const limit of limits) {
            assertion(chunkBlocks(blocks, limit), blocks, limit, `${label}, limit ${limit}`);
        }
    }
};

test("a single block gives one chunk that is exactly that block", () => {
    assert.deepEqual(chunksOf(chunkBlocks([block("Only one.", 0)], 100)), [
        { text: "Only one.", parts: [{ text: "Only one.", start: 0 }] },
    ]);
});

test("chunkBlocks keeps everything in one chunk when it all fits", () => {
    const blocks = [block("One.", 0), block("Two.", 5), block("Three.", 10)];

    assert.deepEqual(chunksOf(chunkBlocks(blocks, 100)), [{
        text: "One.\nTwo.\nThree.",
        parts: [
            { text: "One.", start: 0 },
            { text: "Two.", start: 5 },
            { text: "Three.", start: 10 },
        ],
    }]);
});

test("chunkBlocks opens a second chunk when the next block would cross the limit", () => {
    const blocks = [block("One.", 0), block("Two.", 5), block("Three.", 10)];

    // The part start is counted from the chunk, not from the whole text: the
    // third block sits at 10 in the body and at 0 in the request that carries it.
    assert.deepEqual(chunksOf(chunkBlocks(blocks, 15)), [
        {
            text: "One.\nTwo.",
            parts: [{ text: "One.", start: 0 }, { text: "Two.", start: 5 }],
        },
        { text: "Three.", parts: [{ text: "Three.", start: 0 }] },
    ]);
});

test("the exact boundary: one character less and the last block moves out", () => {
    const blocks = [block("One.", 0), block("Two.", 5), block("Three.", 10)];

    // "One.\nTwo.\nThree." is 16 characters, separators included.
    const fitting = chunkBlocks(blocks, 16);
    assert.equal(fitting.length, 1);
    assert.equal(fitting[0].text.length, 16);

    assert.equal(chunkBlocks(blocks, 15).length, 2);
});

test("the joining newlines count towards the limit", () => {
    const blocks = [block("aaa", 0), block("bbb", 4), block("ccc", 8)];

    // The three texts are 9 characters, the chunk that holds them is 11: the
    // separators are part of what the server is sent, so they are part of what
    // it may refuse.
    assert.deepEqual(chunksOf(chunkBlocks(blocks, 10)), [
        { text: "aaa\nbbb", parts: [{ text: "aaa", start: 0 }, { text: "bbb", start: 4 }] },
        { text: "ccc", parts: [{ text: "ccc", start: 0 }] },
    ]);
    assert.equal(chunkBlocks(blocks, 11).length, 1);
});

test("a block exactly at the limit fills a chunk on its own", () => {
    const exact = "x".repeat(10);

    assert.deepEqual(chunksOf(chunkBlocks([block(exact, 0), block("y", 11)], 10)), [
        { text: exact, parts: [{ text: exact, start: 0 }] },
        { text: "y", parts: [{ text: "y", start: 0 }] },
    ]);
});

test("a block longer than the limit gets an oversized chunk of its own", () => {
    const huge = "z".repeat(25);
    const chunks = chunkBlocks([block("Before.", 0), block(huge, 8), block("After.", 34)], 10);

    // Dropping the paragraph would lose what the user wrote without telling
    // them, which is worse than a request the server answers with its limit.
    assert.deepEqual(chunksOf(chunks), [
        { text: "Before.", parts: [{ text: "Before.", start: 0 }] },
        { text: huge, parts: [{ text: huge, start: 0 }] },
        { text: "After.", parts: [{ text: "After.", start: 0 }] },
    ]);
    assert.ok(chunks[1].text.length > 10);
    assert.equal(chunks[1].parts.length, 1);
});

test("chunkBlocks returns nothing for an empty block list", () => {
    assert.deepEqual(chunksOf(chunkBlocks([], 100)), []);
    assert.deepEqual(chunksOf(chunkBlocks([], 0)), []);
});

test("a limit of zero gives one chunk per block, and loses none", () => {
    // An unusable limit must not glue two paragraphs together nor drop one.
    assert.deepEqual(chunksOf(chunkBlocks([block("One.", 0), block("Two.", 5)], 0)), [
        { text: "One.", parts: [{ text: "One.", start: 0 }] },
        { text: "Two.", parts: [{ text: "Two.", start: 0 }] },
    ]);
});

test("every part slices back out of the chunk that holds it", () => {
    // The property every offset of the whole change rests on.
    forEveryShape((chunks, blocks, limit, where) => {
        for (const chunk of chunks) {
            for (const found of chunk.parts) {
                assert.equal(
                    chunk.text.slice(found.start, found.start + found.text.length),
                    found.text,
                    where,
                );
            }
        }
    });
});

test("a chunk's text is its parts joined by a newline, nothing more", () => {
    forEveryShape((chunks, blocks, limit, where) => {
        for (const chunk of chunks) {
            assert.equal(
                chunk.text,
                partsOf(chunk.parts).map((found) => found.text).join("\n"),
                where,
            );
        }
    });
});

test("the parts of every chunk, in order, are the blocks that were given", () => {
    forEveryShape((chunks, blocks, limit, where) => {
        const parts = chunksOf(chunks).flatMap((chunk) => chunk.parts);

        // None lost, none invented, none duplicated and none reordered: the
        // chunking cuts the text, it never rewrites it.
        assert.deepEqual(
            parts.map((found) => found.text),
            blocksOf(blocks).map((found) => found.text),
            where,
        );
    });
});

test("no chunk crosses the limit unless one block alone already does", () => {
    forEveryShape((chunks, blocks, limit, where) => {
        for (const chunk of chunks) {
            if (chunk.text.length <= limit) {
                continue;
            }
            assert.equal(chunk.parts.length, 1, `${where}: an oversized chunk holds one block`);
            assert.ok(chunk.parts[0].text.length > limit, where);
        }
    });
});

test("a chunk is left no room for the first block of the next one", () => {
    forEveryShape((chunks, blocks, limit, where) => {
        for (let index = 0; index + 1 < chunks.length; index += 1) {
            // A chunk closed early means a request that could have been spared,
            // and the detection reads a shorter text than it could have.
            const joined = chunks[index].text.length + "\n".length
                + chunks[index + 1].parts[0].text.length;
            assert.ok(joined > limit, `${where}: chunk ${index} had room left`);
        }
    });
});

test("a chunk and a split entry carry only the contract fields", () => {
    const [chunk] = chunkBlocks([block("One.", 0), block("Two.", 5)], 100);

    assert.deepEqual(Object.keys(chunk).sort(), ["parts", "text"]);
    assert.deepEqual(Object.keys(chunk.parts[0]).sort(), ["start", "text"]);

    const [entry] = splitMatches([match(0, 4)], partsOf(chunk.parts));

    assert.deepEqual(Object.keys(entry).sort(), ["matches", "text"]);
});

test("a match in the first part keeps its offset", () => {
    const parts = [part("Hello wrold.", 0), part("Second one.", 13)];

    assert.deepEqual(splitOf(splitMatches([match(6, 5)], parts)), [
        { text: "Hello wrold.", matches: [match(6, 5)] },
        { text: "Second one.", matches: [] },
    ]);
});

test("a match in a later part is made relative to that part", () => {
    const parts = [part("Hello world.", 0), part("I recieve the file.", 13)];

    // 15 in the chunk that was sent, 2 in the paragraph the cache files it under.
    assert.deepEqual(splitOf(splitMatches([match(15, 7)], parts)), [
        { text: "Hello world.", matches: [] },
        { text: "I recieve the file.", matches: [match(2, 7)] },
    ]);
});

test("each part gets its own matches", () => {
    const parts = [part("First blcok.", 0), part("Second blokc, two errors here.", 13)];

    assert.deepEqual(splitOf(splitMatches([match(6, 5), match(20, 5), match(27, 3)], parts)), [
        { text: "First blcok.", matches: [match(6, 5)] },
        { text: "Second blokc, two errors here.", matches: [match(7, 5), match(14, 3)] },
    ]);
});

test("a part with no match at all is still in the result", () => {
    // A paragraph found clean must be remembered as clean, or it is sent again
    // at every pass for the rest of the session.
    const parts = [part("All good here.", 0), part("A blcok.", 15)];

    assert.deepEqual(splitOf(splitMatches([match(17, 5)], parts)), [
        { text: "All good here.", matches: [] },
        { text: "A blcok.", matches: [match(2, 5)] },
    ]);
});

test("a match keeps everything but its offset", () => {
    const given = {
        offset: 22,
        length: 7,
        message: "This sentence does not start with an uppercase letter.",
        replacements: ["Chateau", "Château"],
        ruleId: "UPPERCASE_SENTENCE_START",
        categoryId: "CASING",
    };
    const parts = [part("Something before.", 0), part("the chateau burns.", 18)];

    const [, second] = splitMatches([given], parts);

    assert.deepEqual(matchesOf(second.matches), [{ ...given, offset: 4 }]);
    assert.equal(second.text.slice(4, 4 + given.length), "chateau");
});

test("a part's text comes back untouched, spaces included", () => {
    // The cache is keyed by the paragraph's exact text, and splitBlocks keeps
    // the spaces it holds. Trimmed on the way back, the entry would never be
    // found again and the paragraph would be sent at every pass.
    const parts = [part("  Indented line.  ", 0), part("Next.", 19)];

    assert.deepEqual(splitOf(splitMatches([match(2, 8)], parts)), [
        { text: "  Indented line.  ", matches: [match(2, 8)] },
        { text: "Next.", matches: [] },
    ]);
});

test("the entries follow the parts, whatever order the matches came in", () => {
    const parts = [part("First blcok.", 0), part("Second blokc.", 13)];

    assert.deepEqual(splitOf(splitMatches([match(20, 5), match(6, 5)], parts)), [
        { text: "First blcok.", matches: [match(6, 5)] },
        { text: "Second blokc.", matches: [match(7, 5)] },
    ]);
});

test("a match that touches either edge of a part belongs to it", () => {
    const parts = [part("First part.", 0), part("Second part.", 12)];

    // The bounds are the paragraph's own: an error on its first or last
    // character is still an error inside it.
    assert.deepEqual(splitOf(splitMatches([match(12, 6), match(21, 3)], parts)), [
        { text: "First part.", matches: [] },
        { text: "Second part.", matches: [match(0, 6), match(9, 3)] },
    ]);
    assert.deepEqual(splitOf(splitMatches([match(0, 11)], parts))[0].matches, [match(0, 11)]);
});

test("a match straddling two parts is dropped", () => {
    const parts = [part("First part.", 0), part("Second part.", 12)];

    // It covers text from both paragraphs, so it belongs to neither. Filed
    // under one of them it would underline words the server never flagged.
    assert.deepEqual(splitOf(splitMatches([match(6, 10)], parts)), [
        { text: "First part.", matches: [] },
        { text: "Second part.", matches: [] },
    ]);
});

test("a match on the separator between two parts is dropped", () => {
    const parts = [part("First part.", 0), part("Second part.", 12)];

    // The newline belongs to no paragraph: the chunking added it to join them.
    assert.deepEqual(splitOf(splitMatches([match(11, 1)], parts)), [
        { text: "First part.", matches: [] },
        { text: "Second part.", matches: [] },
    ]);
    // Starting on it and running into the next paragraph is no better.
    assert.deepEqual(splitOf(splitMatches([match(11, 3)], parts)), [
        { text: "First part.", matches: [] },
        { text: "Second part.", matches: [] },
    ]);
});

test("a match past the end of the last part is dropped", () => {
    const parts = [part("First part.", 0), part("Second part.", 12)];

    // Nothing to place it on, and slicing there would silently give a shorter
    // string than the match claims to cover.
    assert.deepEqual(splitOf(splitMatches([match(24, 3)], parts)), [
        { text: "First part.", matches: [] },
        { text: "Second part.", matches: [] },
    ]);
    // Starting inside the last part and running past its end is no better.
    assert.deepEqual(splitOf(splitMatches([match(20, 10)], parts)), [
        { text: "First part.", matches: [] },
        { text: "Second part.", matches: [] },
    ]);
});

test("an empty match list still gives one entry per part", () => {
    const parts = [part("One.", 0), part("Two.", 5)];

    assert.deepEqual(splitOf(splitMatches([], parts)), [
        { text: "One.", matches: [] },
        { text: "Two.", matches: [] },
    ]);
});

test("splitMatches on an empty part list gives an empty array", () => {
    assert.deepEqual(splitOf(splitMatches([], [])), []);
    assert.deepEqual(splitOf(splitMatches([match(0, 4)], [])), []);
});

test("the matches given are never touched", () => {
    const given = [match(15, 7), match(6, 5)];
    const parts = [part("Hello wrold.", 0), part("I recieve the file.", 13)];

    const split = splitMatches(given, parts);

    // A shift applied to the caller's own object instead of to a copy would
    // poison the cache that is about to be filled from it.
    assert.deepEqual(given, [match(15, 7), match(6, 5)]);
    assert.deepEqual(matchesOf(split[0].matches), [match(6, 5)]);
    assert.deepEqual(matchesOf(split[1].matches), [match(2, 7)]);
    assert.notEqual(split[1].matches[0], given[0]);

    // And splitting twice gives the same thing, which a shift in place would not.
    assert.deepEqual(splitOf(splitMatches(given, parts)), splitOf(split));
});

test("end to end: a chunked check fills the cache and lands on the right node", () => {
    const first = text("Hello wrold.");
    const clean = text("Nothing wrong with this one.");
    const last = text("I recieve the file tomorrow.");
    const body = el("BODY", {}, el("P", {}, first), el("P", {}, clean), el("P", {}, last));

    const sent = flatten(body);
    const blocks = splitBlocks(sent.text);
    assert.deepEqual(blocksOf(blocks), [
        { text: "Hello wrold.", start: 0 },
        { text: "Nothing wrong with this one.", start: 13 },
        { text: "I recieve the file tomorrow.", start: 42 },
    ]);

    // A limit small enough to cut mid message, as the real one does on a long
    // one. The first two paragraphs travel together, the third alone.
    const chunks = chunkBlocks(blocks, 45);
    assert.deepEqual(chunksOf(chunks), [
        {
            text: "Hello wrold.\nNothing wrong with this one.",
            parts: [
                { text: "Hello wrold.", start: 0 },
                { text: "Nothing wrong with this one.", start: 13 },
            ],
        },
        {
            text: "I recieve the file tomorrow.",
            parts: [{ text: "I recieve the file tomorrow.", start: 0 }],
        },
    ]);

    // What the server answered about each chunk, with offsets relative to the
    // chunk it was given.
    const answers = [[match(6, 5)], [match(2, 7)]];

    const cache = new Map();
    chunks.forEach((chunk, index) => {
        for (const entry of splitMatches(answers[index], chunk.parts)) {
            cache.set(entry.text, entry.matches);
        }
    });

    // Every paragraph is remembered, the clean one included, so the next pass
    // has nothing left to ask.
    assert.deepEqual(keysOf(cache), [
        "Hello wrold.",
        "Nothing wrong with this one.",
        "I recieve the file tomorrow.",
    ]);
    assert.deepEqual(textsOf(missingBlocks(blocks, cache)), []);

    const found = matchesForBlocks(blocks, cache);

    assert.equal(found.length, 2);
    assert.equal(sent.text.slice(found[0].offset, found[0].offset + found[0].length), "wrold");
    assert.equal(sent.text.slice(found[1].offset, found[1].offset + found[1].length), "recieve");
    assertSpans(sent, found[0], first, 6, 11);
    assertSpans(sent, found[1], last, 2, 9);
});

test("end to end: a match the server spread over two paragraphs underlines neither", () => {
    const opening = text("A first line");
    const following = text("a second one.");
    const body = el("BODY", {}, el("P", {}, opening), el("P", {}, following));

    const sent = flatten(body);
    const blocks = splitBlocks(sent.text);
    const [chunk] = chunkBlocks(blocks, 100);
    assert.equal(chunk.text, "A first line\na second one.");

    // A rule that fires across the separator, as one on sentence casing does:
    // it covers the end of one paragraph and the start of the next.
    const cache = new Map();
    for (const entry of splitMatches([match(10, 5)], chunk.parts)) {
        cache.set(entry.text, entry.matches);
    }

    // Both paragraphs are remembered as clean and nothing is placed. Attached
    // to either one, the match would underline text it does not cover.
    assert.deepEqual(keysOf(cache), ["A first line", "a second one."]);
    assert.deepEqual(matchesOf(cache.get("A first line")), []);
    assert.deepEqual(matchesOf(cache.get("a second one.")), []);
    assert.deepEqual(matchesOf(matchesForBlocks(blocks, cache)), []);
});

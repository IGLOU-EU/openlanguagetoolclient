/**
 * The contract of correcting in place, in src/compose/body-text.js: `blockAt`, which
 * names the paragraph an offset falls in, and `afterReplacement`, which moves
 * that paragraph's known matches to where a correction left them.
 *
 * Why they exist, reported after real use: the cache is keyed by the block text,
 * so applying one correction makes its own paragraph unknown, and every other
 * mistake in it loses its underline until the server has answered again. A right
 * click there then offers nothing, and the next correction waits out the pause
 * and the round trip.
 *
 * Replacing a span of known length by a known text shifts everything after it by
 * a known amount, so the rest of the paragraph's matches can be moved instead of
 * thrown away. The guess is never taken for the truth: the paragraph stays out
 * of the real cache, the next pass still asks the server about it, and
 * `matchesForBlocks` reads the provisional results from a second map consulted
 * only where the cache is silent.
 *
 * Everything here turns on one property, the same one the block cache rests on:
 * an offset off by one underlines the wrong word, and a shift computed the wrong
 * way round moves every mistake of the paragraph onto its neighbour.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    assertSpans, block, blocksOf, el, match, matchOf, matchesOf, olcBody, text, textsOf,
} from "./compose-helpers.mjs";

const {
    flatten, splitBlocks, missingBlocks, matchesForBlocks, matchAt, blockAt, afterReplacement,
} = olcBody;

/** Three paragraphs, as splitBlocks cuts them out of a flattened body. */
const blocks = [block("One.", 0), block("Two.", 5), block("Three.", 10)];

/** The span one correction replaced: five characters at ten, made seven. */
const AT = 10;
const LENGTH = 5;
const VALUE = "correct";

/**
 * An unusable call answers with an empty list of its own, never an exception and
 * never a shifted offset built out of nonsense.
 */
const assertNothing = (call) => {
    let found;
    assert.doesNotThrow(() => {
        found = call();
    });
    assert.ok(Array.isArray(found), "expected an array");
    assert.deepEqual(matchesOf(found), []);
};

/** Offsets no position can ever resolve to, as matchAt is given them too. */
const notNumbers = [
    ["undefined", undefined],
    ["null", null],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["minus Infinity", -Infinity],
    ["a numeric string", "5"],
    ["an empty string", ""],
    ["a word", "five"],
    ["true", true],
    ["false", false],
    ["an object", {}],
    ["an empty array", []],
    ["an array holding a number", [5]],
];

for (const [offset, expected, label] of [
    [-1, null, "before the text"],
    [0, 0, "the first character of the first block"],
    [2, 0, "inside the first block"],
    [3, 0, "the last character of the first block"],
    [4, null, "the character just after the first block"],
    [5, 1, "the first character of a later block"],
    [6, 1, "inside a later block"],
    [8, 1, "the last character of a later block"],
    [9, null, "the character just after that one"],
    [10, 2, "the first character of the last block"],
    [15, 2, "the last character of the last block"],
    [16, null, "just past the last block"],
    [1000, null, "far past the text"],
]) {
    test(`blockAt at offset ${offset}, ${label}`, () => {
        // A block's span stops before its own length, so the position where the
        // separator sits belongs to no block: nothing was sent for it, and
        // nothing can be corrected there.
        assert.equal(blockAt(blocks, offset), expected === null ? null : blocks[expected]);
    });
}

test("blockAt finds no block on the blank lines the split dropped", () => {
    // What "First.\n\n\nSecond.\n" leaves: two blocks with a gap of three
    // positions between them, none of which was ever checked.
    const spaced = [block("First.", 0), block("Second.", 9)];

    assert.equal(blockAt(spaced, 5), spaced[0]);
    assert.equal(blockAt(spaced, 6), null);
    assert.equal(blockAt(spaced, 7), null);
    assert.equal(blockAt(spaced, 8), null);
    assert.equal(blockAt(spaced, 9), spaced[1]);
});

test("blockAt finds no block before the first one", () => {
    // A body opening on a quote or an empty line pushes its first block down,
    // and the positions above it belong to nothing.
    const pushed = [block("First.", 1)];

    assert.equal(blockAt(pushed, 0), null);
    assert.equal(blockAt(pushed, -1), null);
    assert.equal(blockAt(pushed, 1), pushed[0]);
});

test("blockAt on an empty block list finds nothing", () => {
    assert.equal(blockAt([], 0), null);
    assert.equal(blockAt([], 5), null);
    assert.equal(blockAt([], -1), null);
});

test("blockAt hands back the block itself, not a copy of it", () => {
    // Its text is the cache key the adjusted matches are filed under, and its
    // start is what turns the offset into a paragraph relative one.
    const found = blockAt(blocks, 6);

    assert.equal(found, blocks[1]);
    assert.equal(found.text, "Two.");
    assert.equal(found.start, 5);
});

for (const [label, offset] of notNumbers) {
    test(`blockAt on an offset that is no finite number (${label}) finds nothing`, () => {
        // The offset comes from a position the browser resolved, so an unusable
        // one is a correction with nowhere to go, never an exception. A numeric
        // string would otherwise compare as the number it looks like.
        assert.doesNotThrow(() => blockAt(blocks, offset));
        assert.equal(blockAt(blocks, offset), null);
    });
}

test("blockAt works on the blocks the split really returns", () => {
    // The handmade lists above prove blockAt alone. This one proves the two
    // agree on what a block's span is.
    const found = splitBlocks("One.\nTwo.\nThree.\n");

    assert.deepEqual(blocksOf(found), blocksOf(blocks));
    for (const one of found) {
        assert.equal(blockAt(found, one.start), one);
        assert.equal(blockAt(found, one.start + one.text.length - 1), one);
        assert.equal(blockAt(found, one.start + one.text.length), null);
    }
});

for (const [label, given, expected] of [
    ["a match before the span", match(2, 3), 2],
    ["a match ending exactly where the span starts", match(5, 5), 5],
    ["a match touching the span's first character", match(8, 3), null],
    ["a match starting before and ending inside", match(8, 4), null],
    ["a match exactly on the span, the corrected one", match(10, 5), null],
    ["a match inside the span", match(11, 2), null],
    ["a match starting inside and ending after", match(12, 6), null],
    ["a match touching the span's last character", match(14, 3), null],
    ["a match containing the span", match(8, 10), null],
    ["a match starting exactly where the span ends", match(15, 4), 17],
    ["a match after the span", match(20, 3), 22],
]) {
    const verdict = expected === null ? "drops" : `keeps at ${expected}`;

    test(`afterReplacement ${verdict}: ${label}`, () => {
        // Seven characters written over five, so what survives past the span
        // moves by two. What overlapped it described text that is gone, and
        // underlining it again would mark a word nothing was said about.
        const found = afterReplacement([given], AT, LENGTH, VALUE);

        assert.ok(Array.isArray(found));
        if (expected === null) {
            assert.deepEqual(matchesOf(found), []);
            return;
        }
        assert.deepEqual(matchesOf(found), [{ ...given, offset: expected }]);
    });
}

test("afterReplacement sorts a whole paragraph's matches in one call", () => {
    const given = [
        match(2, 3), match(5, 5), match(8, 4), match(10, 5), match(12, 6), match(15, 4),
        match(20, 3),
    ];

    assert.deepEqual(matchesOf(afterReplacement(given, AT, LENGTH, VALUE)), [
        match(2, 3), match(5, 5), match(17, 4), match(22, 3),
    ]);
});

test("afterReplacement keeps the matches in the order it was given them", () => {
    // The server sends them in its own order and the menu reads the first that
    // covers the pointer, so a reordering here changes what a right click
    // offers.
    const given = [match(20, 3), match(2, 3), match(15, 4), match(5, 5)];

    const found = afterReplacement(given, AT, LENGTH, VALUE);

    assert.deepEqual(Array.from(found, (one) => one.offset), [22, 2, 17, 5]);
});

for (const [label, value, moved] of [
    ["longer than what it replaces", "correction", 20],
    ["shorter than what it replaces", "fix", 13],
    ["of the same length, which shifts nothing", "fixed", 15],
    ["the empty string, which deletes the span", "", 10],
]) {
    test(`afterReplacement by a text ${label}`, () => {
        const given = [match(2, 3), match(15, 4)];

        // The match before the span never moves, whatever was written over it.
        assert.deepEqual(matchesOf(afterReplacement(given, AT, LENGTH, value)), [
            match(2, 3), { ...match(15, 4), offset: moved },
        ]);
    });
}

test("afterReplacement of a zero length span shifts by the whole insertion", () => {
    // What an inserted word looks like: nothing was taken out, so everything
    // from the insertion point on moves by its length.
    const given = [match(2, 3), match(5, 5), match(8, 5), match(10, 4), match(20, 3)];

    // The match spanning the insertion point is dropped: a word with something
    // written into the middle of it is not the word the server flagged.
    assert.deepEqual(matchesOf(afterReplacement(given, AT, 0, "and ")), [
        match(2, 3), match(5, 5), { ...match(10, 4), offset: 14 }, { ...match(20, 3), offset: 24 },
    ]);
});

test("afterReplacement on an empty match list gives an empty list", () => {
    // A paragraph the server found clean, corrected by hand anyway.
    assert.deepEqual(matchesOf(afterReplacement([], AT, LENGTH, VALUE)), []);
    assert.deepEqual(matchesOf(afterReplacement([], 0, 0, "")), []);
});

test("afterReplacement never touches the matches it is given", () => {
    const given = [match(2, 3), match(10, 5), match(20, 3)];

    const found = afterReplacement(given, AT, LENGTH, VALUE);

    // These are the cache's own objects: a shift applied in place would double
    // on the next correction and poison the entry for the whole session.
    assert.deepEqual(given, [match(2, 3), match(10, 5), match(20, 3)]);
    assert.notEqual(found[0], given[0]);
    assert.notEqual(found[1], given[2]);
    assert.deepEqual(matchesOf(afterReplacement(given, AT, LENGTH, VALUE)), matchesOf(found));
});

test("a match keeps everything but its offset", () => {
    const moved = {
        offset: 20,
        length: 7,
        message: "This sentence does not start with an uppercase letter.",
        replacements: ["Chateau", "Château"],
        ruleId: "UPPERCASE_SENTENCE_START",
        categoryId: "CASING",
    };
    const untouched = { ...moved, offset: 2, length: 3 };

    const found = afterReplacement([untouched, moved], AT, LENGTH, VALUE);

    // The menu is built from the message and the replacements, so a match that
    // arrives there stripped of them offers nothing.
    assert.deepEqual(matchOf(found[0]), untouched);
    assert.deepEqual(matchOf(found[1]), { ...moved, offset: 22 });
});

for (const [label, matches] of [
    ["undefined", undefined],
    ["null", null],
    ["a string", "recieve"],
    ["a number", 3],
    ["true", true],
    ["an object", {}],
    ["a single match rather than a list", match(20, 3)],
    ["a map", new Map([["Hello wrold.", [match(6, 5)]]])],
]) {
    test(`afterReplacement on matches that are no list (${label}) gives nothing`, () => {
        assertNothing(() => afterReplacement(matches, AT, LENGTH, VALUE));
    });
}

for (const [label, offset] of [...notNumbers, ["a negative number", -1]]) {
    test(`afterReplacement at an offset that is unusable (${label}) gives nothing`, () => {
        // The offsets come from the order the menu sent, which travelled through
        // a message and is worth no more trust than that.
        assertNothing(() => afterReplacement([match(20, 3)], offset, LENGTH, VALUE));
    });
}

for (const [label, length] of [...notNumbers, ["a negative number", -1]]) {
    test(`afterReplacement over a length that is unusable (${label}) gives nothing`, () => {
        assertNothing(() => afterReplacement([match(20, 3)], AT, length, VALUE));
    });
}

for (const [label, value] of [
    ["undefined", undefined],
    ["null", null],
    ["a number", 5],
    ["true", true],
    ["an object", {}],
    ["an empty array", []],
    ["an array holding a string", ["correct"]],
]) {
    test(`afterReplacement by a value that is no string (${label}) gives nothing`, () => {
        // Without a text there is no length to shift by, and a guessed one would
        // move every match of the paragraph onto the wrong word.
        assertNothing(() => afterReplacement([match(20, 3)], AT, LENGTH, value));
    });
}

test("matchesForBlocks with two arguments answers from the cache alone", () => {
    const cache = new Map([["Hello wrold.", [match(6, 5)]]]);
    const given = [block("Hello wrold.", 0), block("I recieve the file.", 13)];

    // The call the pass has always made, unchanged by the third argument.
    assert.deepEqual(matchesOf(matchesForBlocks(given, cache)), [match(6, 5)]);
    assert.deepEqual(matchesOf(matchesForBlocks(given, new Map())), []);
});

test("the fallback answers for a block the cache does not hold", () => {
    const cache = new Map([["Hello wrold.", [match(6, 5)]]]);
    const guessed = new Map([["I recieve the file.", [match(2, 7)]]]);
    const given = [block("Hello wrold.", 0), block("I recieve the file.", 13)];

    assert.deepEqual(matchesOf(matchesForBlocks(given, cache, guessed)), [
        match(6, 5), match(15, 7),
    ]);
});

test("the cache wins over the fallback for the same block", () => {
    const corrected = "I receive the file.";
    const cache = new Map([[corrected, [match(14, 4)]]]);
    const guessed = new Map([[corrected, [match(2, 7)]]]);

    // The server has answered about that paragraph since, so the guess made
    // when it was corrected is worthless and must not outlive it.
    assert.deepEqual(
        matchesOf(matchesForBlocks([block(corrected, 13)], cache, guessed)),
        [match(27, 4)],
    );
});

test("a block the cache holds as clean falls back on nothing", () => {
    const corrected = "I receive the file.";
    const cache = new Map([[corrected, []]]);
    const guessed = new Map([[corrected, [match(2, 7)]]]);

    // An entry, even an empty one, is an answer: a paragraph found clean stays
    // free of underline instead of wearing the guess again.
    assert.deepEqual(matchesOf(matchesForBlocks([block(corrected, 0)], cache, guessed)), []);
});

test("a block neither map holds contributes nothing", () => {
    const cache = new Map([["Hello wrold.", [match(6, 5)]]]);
    const guessed = new Map([["I recieve the file.", [match(2, 7)]]]);
    const given = [block("Never seen, just typed.", 0)];

    // It is waiting for its own request, and until then it must borrow no
    // neighbour's match.
    assert.deepEqual(matchesOf(matchesForBlocks(given, cache, guessed)), []);
});

test("both maps shift their matches by the block's own start", () => {
    const cache = new Map([["Hello wrold.", [match(6, 5)]]]);
    const guessed = new Map([["I recieve the file.", [match(2, 7)]]]);

    assert.deepEqual(
        matchesOf(matchesForBlocks(
            [block("Hello wrold.", 0), block("I recieve the file.", 13)], cache, guessed,
        )),
        [match(6, 5), match(15, 7)],
    );

    // Far into a long body, where a shift computed from the wrong base is not
    // off by one but off by everything.
    assert.deepEqual(
        matchesOf(matchesForBlocks(
            [block("I recieve the file.", 4096), block("Hello wrold.", 4116)], cache, guessed,
        )),
        [match(4098, 7), match(4122, 5)],
    );
});

test("the fallback's matches come back untouched, twice in a row", () => {
    const guessed = [match(2, 7)];
    const fallback = new Map([["I recieve the file.", guessed]]);
    const given = [block("I recieve the file.", 13)];

    const first = matchesOf(matchesForBlocks(given, new Map(), fallback));
    const second = matchesOf(matchesForBlocks(given, new Map(), fallback));

    // The provisional map outlives the repaint, so a shift applied to its own
    // objects would double at the next pass.
    assert.deepEqual(first, [match(15, 7)]);
    assert.deepEqual(second, first);
    assert.deepEqual(guessed, [match(2, 7)]);
    assert.notEqual(matchesForBlocks(given, new Map(), fallback)[0], guessed[0]);
});

test("end to end: correcting one mistake leaves the others on their own words", () => {
    const opening = text("Hello wrold.");
    const written = text("I recieve the fille wich you sned me.");
    const body = el("BODY", {}, el("P", {}, opening), el("P", {}, written));

    const before = flatten(body);
    const paragraph = written.nodeValue;
    assert.equal(before.text, `Hello wrold.\n${paragraph}\n`);

    const blocksBefore = splitBlocks(before.text);
    assert.deepEqual(blocksOf(blocksBefore), [
        { text: "Hello wrold.", start: 0 },
        { text: paragraph, start: 13 },
    ]);

    // The cache as the server left it: four mistakes in the second paragraph,
    // every offset relative to that paragraph alone.
    const wrong = (word) => match(paragraph.indexOf(word), word.length, `About ${word}`);
    const known = [wrong("recieve"), wrong("fille"), wrong("wich"), wrong("sned")];
    const cache = new Map([["Hello wrold.", [match(6, 5)]], [paragraph, known]]);
    assert.deepEqual(matchesOf(known), [
        match(2, 7, "About recieve"), match(14, 5, "About fille"),
        match(20, 4, "About wich"), match(29, 4, "About sned"),
    ]);

    // The user right clicks on the third mistake and picks its replacement.
    const placed = matchesForBlocks(blocksBefore, cache);
    const found = matchAt(placed, before.text.indexOf("wich") + 1);
    assert.ok(found, "expected a match under the pointer");
    assert.equal(before.text.slice(found.offset, found.offset + found.length), "wich");

    // Which paragraph it belongs to, and where inside it: the cache is keyed by
    // the paragraph, so its own matches are what has to be adjusted.
    const home = blockAt(blocksBefore, found.offset);
    assert.equal(home, blocksBefore[1]);
    const at = found.offset - home.start;
    assert.equal(at, 20);

    const guessed = afterReplacement(cache.get(home.text), at, found.length, "which");
    assert.deepEqual(matchesOf(guessed), [
        match(2, 7, "About recieve"), match(14, 5, "About fille"), match(30, 4, "About sned"),
    ]);

    // The editor writes the replacement, so the paragraph is no longer the one
    // the cache knows.
    written.nodeValue = `${paragraph.slice(0, at)}which${paragraph.slice(at + found.length)}`;
    assert.equal(written.nodeValue, "I recieve the fille which you sned me.");

    const after = flatten(body);
    const blocksAfter = splitBlocks(after.text);
    const corrected = blocksAfter[1].text;
    assert.equal(corrected, written.nodeValue);

    // Filed under the corrected text, consulted only because the real cache
    // knows nothing about it.
    const provisional = new Map([[corrected, guessed]]);
    assert.deepEqual(textsOf(missingBlocks(blocksAfter, cache)), [corrected]);

    const repainted = matchesForBlocks(blocksAfter, cache, provisional);

    // The property this whole fix exists for: the mistake that was corrected is
    // gone, the three others are still on their own words, and the untouched
    // paragraph above still comes from the cache.
    assert.equal(repainted.length, 4);
    assert.deepEqual(
        Array.from(repainted, (one) => after.text.slice(one.offset, one.offset + one.length)),
        ["wrold", "recieve", "fille", "sned"],
    );
    assertSpans(after, repainted[0], opening, 6, 11);
    assertSpans(after, repainted[1], written, 2, 9);
    assertSpans(after, repainted[2], written, 14, 19);
    assertSpans(after, repainted[3], written, 30, 34);
    assert.ok(after.text.includes("which you"));

    // And the guess carries what the menu needs, so a right click on one of the
    // three offers its replacements without waiting for the server.
    const still = matchAt(repainted, after.text.indexOf("sned") + 1);
    assert.ok(still, "expected the fourth mistake to still be reachable");
    assert.equal(still.message, "About sned");
    assert.deepEqual([...still.replacements], ["fixed"]);
});

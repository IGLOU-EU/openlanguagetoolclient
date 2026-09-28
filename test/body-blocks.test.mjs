/**
 * The contract of the block cache in src/compose/body-text.js: the text is cut into
 * blocks, each block's result is remembered under its own text, and only the
 * blocks never seen before are worth a request.
 *
 * The cache is keyed by the block text itself, so an edited paragraph is a
 * miss and an untouched one is a hit. Everything here therefore turns on one
 * property: a block's offset inside the whole text, and the shift it applies
 * to the matches that came back for that block alone. An offset off by one
 * underlines the wrong word, so the boundaries are asserted, not assumed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    assertSpans, block, blocksOf, el, keysOf, match, matchOf, matchesOf, olcBody, text, textsOf,
} from "./compose-helpers.mjs";

const { flatten, splitBlocks, missingBlocks, matchesForBlocks, prune } = olcBody;

/** The quote Thunderbird itself inserts when replying. */
const cite = (...children) => el("BLOCKQUOTE", { attrs: { type: "cite" } }, ...children);

/**
 * True for a Map whatever realm built it.
 *
 * prune returns one built inside the vm, where instanceof Map is false. The
 * internal slot is what makes a Map, and toString is what reads it across
 * realms.
 */
const isMap = (value) => Object.prototype.toString.call(value) === "[object Map]";

test("splitBlocks returns one block for a single paragraph", () => {
    const blocks = splitBlocks("Hello world.");

    assert.ok(Array.isArray(blocks));
    assert.deepEqual(blocksOf(blocks), [{ text: "Hello world.", start: 0 }]);
});

test("splitBlocks drops the empty piece the trailing newline leaves", () => {
    // flatten always closes the last block with a separator, so this is the
    // shape the split is given in practice.
    assert.deepEqual(blocksOf(splitBlocks("Hello world.\n")), [
        { text: "Hello world.", start: 0 },
    ]);
});

test("splitBlocks numbers several paragraphs from the start of the text", () => {
    assert.deepEqual(blocksOf(splitBlocks("One.\nTwo.\nThree.\n")), [
        { text: "One.", start: 0 },
        { text: "Two.", start: 5 },
        { text: "Three.", start: 10 },
    ]);
});

test("splitBlocks lets a dropped piece shift the blocks after it", () => {
    assert.deepEqual(blocksOf(splitBlocks("First.\n\n\nSecond.\n")), [
        { text: "First.", start: 0 },
        { text: "Second.", start: 9 },
    ]);
});

test("splitBlocks drops a piece that holds nothing but whitespace", () => {
    assert.deepEqual(blocksOf(splitBlocks("First.\n   \nSecond.\n")), [
        { text: "First.", start: 0 },
        { text: "Second.", start: 11 },
    ]);

    // A single space is the piece an editor leaves behind most often.
    assert.deepEqual(blocksOf(splitBlocks("First.\n \nSecond.")), [
        { text: "First.", start: 0 },
        { text: "Second.", start: 9 },
    ]);

    // A tab, a no-break space and a stray carriage return are no more
    // checkable, and Thunderbird puts no-break spaces in a body freely.
    assert.deepEqual(blocksOf(splitBlocks("Kept.\n\t\n   \n\r\nAlso kept.\n")), [
        { text: "Kept.", start: 0 },
        { text: "Also kept.", start: 14 },
    ]);
});

test("splitBlocks keeps the spaces inside a block it keeps", () => {
    // Nothing is normalized, or the offsets a block's matches carry would no
    // longer point into the text that was sent.
    assert.deepEqual(blocksOf(splitBlocks("  Indented line.  \nNext.\n")), [
        { text: "  Indented line.  ", start: 0 },
        { text: "Next.", start: 19 },
    ]);
});

test("splitBlocks returns nothing for an empty or blank text", () => {
    assert.deepEqual(blocksOf(splitBlocks("")), []);
    assert.deepEqual(blocksOf(splitBlocks("\n")), []);
    assert.deepEqual(blocksOf(splitBlocks("   ")), []);
    assert.deepEqual(blocksOf(splitBlocks("\n  \n\t\n")), []);
});

test("every block slices back out of the text it came from", () => {
    const texts = [
        "Hello world.",
        "Hello world.\n",
        "One.\nTwo.\nThree.\n",
        "First.\n\n\nSecond.\n",
        "First.\n   \nSecond.\n",
        "  Indented line.  \nNext.\n",
        "Kept.\n\t\n   \n\r\nAlso kept.\n",
        "\nLeading separator.\n",
        "Une phrase accentuée : déjà vu.\nDeux \u{1f600} emoji \u{1f600}.\n",
    ];

    for (const whole of texts) {
        const blocks = splitBlocks(whole);
        assert.ok(blocks.length > 0, `expected blocks in ${JSON.stringify(whole)}`);
        let previous = -1;
        for (const found of blocks) {
            assert.equal(whole.slice(found.start, found.start + found.text.length), found.text);
            // A newline inside a block would reach the server as a boundary it
            // was told nothing about.
            assert.ok(!found.text.includes("\n"));
            assert.ok(found.text.trim() !== "");
            assert.ok(found.start > previous, "blocks come in the order of the text");
            previous = found.start;
        }
    }
});

test("missingBlocks asks for everything when the cache is empty", () => {
    const blocks = [block("One.", 0), block("Two.", 5)];

    const missing = missingBlocks(blocks, new Map());

    assert.ok(Array.isArray(missing));
    assert.deepEqual(textsOf(missing), ["One.", "Two."]);
});

test("missingBlocks asks for nothing when the cache holds every block", () => {
    const cache = new Map([["One.", []], ["Two.", [match(0, 4)]]]);

    assert.deepEqual(textsOf(missingBlocks([block("One.", 0), block("Two.", 5)], cache)), []);
});

test("missingBlocks asks only for the blocks the cache misses", () => {
    const cache = new Map([["Known.", [match(0, 6)]], ["Gone.", [match(0, 5)]]]);
    const blocks = [block("New.", 0), block("Known.", 5), block("Newer.", 12)];

    const missing = missingBlocks(blocks, cache);

    assert.deepEqual(textsOf(missing), ["New.", "Newer."]);
    // A query writes nothing: an entry added here would answer for a block the
    // server never saw.
    assert.deepEqual(cache, new Map([["Known.", [match(0, 6)]], ["Gone.", [match(0, 5)]]]));
});

test("two identical blocks cost one request", () => {
    const repeated = "Same paragraph twice.";
    const blocks = [block(repeated, 0), block("Between.", 22), block(repeated, 31)];

    // Neighbours or not, the text is the key, so one entry answers for both.
    assert.deepEqual(textsOf(missingBlocks(blocks, new Map())), [repeated, "Between."]);
    assert.deepEqual(
        textsOf(missingBlocks([block(repeated, 0), block(repeated, 22)], new Map())),
        [repeated],
    );
});

test("a block cached with no match at all is not asked again", () => {
    // A clean paragraph is the common case. Reading the entry instead of its
    // contents is what keeps it from being sent at every pass.
    const cache = new Map([["Nothing wrong here.", []]]);

    assert.deepEqual(textsOf(missingBlocks([block("Nothing wrong here.", 0)], cache)), []);
});

test("missingBlocks on an empty block list asks for nothing", () => {
    assert.deepEqual(textsOf(missingBlocks([], new Map())), []);
    assert.deepEqual(textsOf(missingBlocks([], new Map([["One.", [match(0, 4)]]]))), []);
});

test("a match of the first block keeps its offset", () => {
    const cache = new Map([["Hello wrold.", [match(6, 5)]]]);

    const found = matchesForBlocks([block("Hello wrold.", 0)], cache);

    assert.ok(Array.isArray(found));
    assert.deepEqual(matchesOf(found), [match(6, 5)]);
});

test("a match is shifted by the start of its block", () => {
    const cache = new Map([["I recieve the file.", [match(2, 7)]]]);

    assert.deepEqual(
        matchesOf(matchesForBlocks([block("I recieve the file.", 13)], cache)),
        [match(15, 7)],
    );

    // Far into a long body, where a shift computed from the wrong base is not
    // off by one but off by everything.
    assert.deepEqual(
        matchesOf(matchesForBlocks([block("I recieve the file.", 4096)], cache)),
        [match(4098, 7)],
    );
});

test("matchesForBlocks follows the blocks and shifts each by its own start", () => {
    const cache = new Map([
        ["First blcok.", [match(6, 5)]],
        ["Second blokc, two errors here.", [match(7, 5), match(14, 3)]],
    ]);
    const blocks = [block("First blcok.", 0), block("Second blokc, two errors here.", 13)];

    assert.deepEqual(matchesOf(matchesForBlocks(blocks, cache)), [
        match(6, 5),
        match(20, 5),
        match(27, 3),
    ]);

    // The order is the order of the blocks, not the order of the cache.
    const reversed = [blocks[1], blocks[0]];
    assert.deepEqual(
        Array.from(matchesForBlocks(reversed, cache), (found) => found.offset),
        [20, 27, 6],
    );
});

test("a block the cache does not hold contributes nothing", () => {
    const cache = new Map([["Known blcok.", [match(6, 5)]]]);
    const blocks = [block("Never seen, just typed.", 0), block("Known blcok.", 24)];

    // The unknown block is waiting for its own request, and until then it has
    // no match to place. It must not borrow its neighbour's.
    assert.deepEqual(matchesOf(matchesForBlocks(blocks, cache)), [match(30, 5)]);
});

test("a block cached with an empty match list contributes nothing", () => {
    const cache = new Map([["All good here.", []], ["A blcok.", [match(2, 5)]]]);
    const blocks = [block("All good here.", 0), block("A blcok.", 15)];

    assert.deepEqual(matchesOf(matchesForBlocks(blocks, cache)), [match(17, 5)]);
});

test("the cached matches come back untouched, twice in a row", () => {
    const cached = [match(2, 7)];
    const cache = new Map([["I recieve the file.", cached]]);
    const blocks = [block("I recieve the file.", 13)];

    const first = matchesOf(matchesForBlocks(blocks, cache));
    const second = matchesOf(matchesForBlocks(blocks, cache));

    // A shift applied to the cached object instead of to a copy would double on
    // the second pass, and the cache would be poisoned for the whole session.
    assert.deepEqual(first, [match(15, 7)]);
    assert.deepEqual(second, first);
    assert.deepEqual(cached, [match(2, 7)]);
    assert.notEqual(matchesForBlocks(blocks, cache)[0], cached[0]);
});

test("a match keeps everything but its offset", () => {
    const cached = {
        offset: 4,
        length: 7,
        message: "This sentence does not start with an uppercase letter.",
        replacements: ["Chateau", "Château"],
        ruleId: "UPPERCASE_SENTENCE_START",
        categoryId: "CASING",
    };
    const cache = new Map([["the chateau burns.", [cached]]]);

    const [found] = matchesForBlocks([block("the chateau burns.", 30)], cache);

    assert.deepEqual(matchOf(found), { ...cached, offset: 34 });
});

test("two identical blocks each get the matches, shifted their own way", () => {
    const repeated = "Same wrold twice.";
    const cache = new Map([[repeated, [match(5, 5)]]]);

    assert.deepEqual(
        matchesOf(matchesForBlocks([block(repeated, 0), block(repeated, 18)], cache)),
        [match(5, 5), match(23, 5)],
    );
});

test("matchesForBlocks returns nothing without blocks or without a cache", () => {
    assert.deepEqual(matchesOf(matchesForBlocks([], new Map())), []);
    assert.deepEqual(matchesOf(matchesForBlocks([], new Map([["One.", [match(0, 4)]]]))), []);
    assert.deepEqual(matchesOf(matchesForBlocks([block("One.", 0)], new Map())), []);
});

test("prune keeps the entries the blocks still name and drops the others", () => {
    const kept = [match(6, 5)];
    const cache = new Map([["Still there.", kept], ["Edited away.", [match(0, 6)]]]);

    const pruned = prune(cache, [block("Still there.", 0), block("Typed since.", 13)]);

    assert.ok(isMap(pruned));
    assert.deepEqual(keysOf(pruned), ["Still there."]);
    assert.deepEqual(matchesOf(pruned.get("Still there.")), matchesOf(kept));
});

test("prune never touches the cache it is given", () => {
    const cache = new Map([["Still there.", [match(6, 5)]], ["Edited away.", [match(0, 6)]]]);

    const pruned = prune(cache, [block("Still there.", 0)]);

    assert.notEqual(pruned, cache);
    assert.equal(cache.size, 2);
    assert.deepEqual(keysOf(cache), ["Still there.", "Edited away."]);
    assert.deepEqual(cache, new Map([
        ["Still there.", [match(6, 5)]],
        ["Edited away.", [match(0, 6)]],
    ]));
});

test("prune keeps the single entry of a duplicated block", () => {
    const repeated = "Same paragraph twice.";
    const cache = new Map([[repeated, [match(5, 9)]], ["Gone.", []]]);

    const pruned = prune(cache, [block(repeated, 0), block(repeated, 22)]);

    assert.equal(pruned.size, 1);
    assert.deepEqual(keysOf(pruned), [repeated]);
});

test("prune returns an empty map for an empty block list", () => {
    const cache = new Map([["One.", [match(0, 4)]]]);

    const pruned = prune(cache, []);

    assert.ok(isMap(pruned));
    assert.equal(pruned.size, 0);
    assert.equal(cache.size, 1);
});

test("prune on an empty cache returns an empty map", () => {
    const pruned = prune(new Map(), [block("One.", 0)]);

    assert.ok(isMap(pruned));
    assert.equal(pruned.size, 0);
});

test("prune invents nothing for a block the cache never held", () => {
    const cache = new Map([["Known.", [match(0, 6)]]]);

    const pruned = prune(cache, [block("Known.", 0), block("Never checked.", 7)]);

    assert.deepEqual(keysOf(pruned), ["Known."]);
    assert.ok(!pruned.has("Never checked."));
});

test("end to end: a cached match lands on the node that holds the error", () => {
    const first = text("Hello wrold.");
    const second = text("I recieve the file tomorrow.");
    const body = el("BODY", {},
        el("P", {}, first),
        el("P", {}, second),
        cite(el("P", {}, text("Their message, not mine."))),
    );

    const sent = flatten(body);
    assert.equal(sent.text, "Hello wrold.\nI recieve the file tomorrow.\n");

    const blocks = splitBlocks(sent.text);
    assert.deepEqual(blocksOf(blocks), [
        { text: "Hello wrold.", start: 0 },
        { text: "I recieve the file tomorrow.", start: 13 },
    ]);

    // The cache as the server left it: one entry per block, every offset
    // relative to that block alone.
    const cache = new Map([
        ["Hello wrold.", [match(6, 5)]],
        ["I recieve the file tomorrow.", [match(2, 7)]],
    ]);

    const found = matchesForBlocks(blocks, cache);

    assert.equal(found.length, 2);
    assert.equal(sent.text.slice(found[0].offset, found[0].offset + found[0].length), "wrold");
    assert.equal(sent.text.slice(found[1].offset, found[1].offset + found[1].length), "recieve");
    assertSpans(sent, found[0], first, 6, 11);
    assertSpans(sent, found[1], second, 2, 9);
});

test("end to end: editing one paragraph only asks the server about that one", () => {
    const opening = text("Hello wrold.");
    const edited = text("I recieve the file tomorrow.");
    const body = el("BODY", {}, el("P", {}, opening), el("P", {}, edited));
    const cache = new Map();

    // First pass: nothing is known, so both blocks are worth a request.
    const firstBlocks = splitBlocks(flatten(body).text);
    assert.deepEqual(textsOf(missingBlocks(firstBlocks, cache)), [
        "Hello wrold.",
        "I recieve the file tomorrow.",
    ]);

    // The server answered and the compose window remembers.
    cache.set("Hello wrold.", [match(6, 5)]);
    cache.set("I recieve the file tomorrow.", [match(2, 7)]);

    // The user fixes the second paragraph and writes a third.
    edited.nodeValue = "I receive the file tomorrow.";
    body.childNodes.push(el("P", {}, text("Sent from my desk.")));

    const sent = flatten(body);
    const blocks = splitBlocks(sent.text);

    // Only what changed and what is new leaves the machine.
    assert.deepEqual(textsOf(missingBlocks(blocks, cache)), [
        "I receive the file tomorrow.",
        "Sent from my desk.",
    ]);

    // The untouched paragraph keeps its underline meanwhile, and the stale
    // entry places nothing.
    const found = matchesForBlocks(blocks, cache);
    assert.deepEqual(matchesOf(found), [match(6, 5)]);
    assertSpans(sent, found[0], opening, 6, 11);

    // And the paragraph that was edited stops weighing on the cache.
    const pruned = prune(cache, blocks);
    assert.deepEqual(keysOf(pruned), ["Hello wrold."]);
    assert.equal(cache.size, 2);
});

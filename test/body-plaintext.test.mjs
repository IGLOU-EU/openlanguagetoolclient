/**
 * The contract of a message composed in plain text: the quote is a subtree to
 * skip and the signature is a line to cut at.
 *
 * Thunderbird marks neither of them the way it does in HTML mode. It wraps the
 * quoted message in `span[_moz_quote="true"]`, which its own attachment
 * reminder skips by that very selector, and it delimits the signature with a
 * line of exactly two hyphens and a space and with nothing else, which the same
 * reminder finds by searching for "-- \n" in the body text. Without both rules a
 * plain text reply reaches the server whole, and worse, a right click inside the
 * quote offers a correction that the write then applies to what the other person
 * wrote.
 *
 * A file of its own because these two rules answer one composition mode, while
 * body-text.test.mjs holds what the flattening owes every message.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { bareEl, block, blocksOf, el, olcBody, text } from "./compose-helpers.mjs";

const { isSkipped, flatten, locate, offsetOf, splitBlocks, beforeSignature } = olcBody;

/** The quote Thunderbird wraps the quoted message in, in plain text mode. */
const quote = (...children) => el("SPAN", { attrs: { _moz_quote: "true" } }, ...children);

/** Where the block after this one starts, separator included. */
const after = (start, content) => start + content.length + "\n".length;

test("isSkipped recognizes the plain text quote on the attribute alone", () => {
    assert.equal(isSkipped(quote()), true);
    // Thunderbird writes "true", but the rule is the presence of the marker and
    // not its value: the styling selector it ships reads `span[_moz_quote]`.
    assert.equal(isSkipped(el("SPAN", { attrs: { _moz_quote: "false" } })), true);
    assert.equal(isSkipped(el("SPAN", { attrs: { _moz_quote: "" } })), true);
});

test("isSkipped skips a _moz_quote element whatever its tag", () => {
    assert.equal(isSkipped(el("SPAN", { attrs: { _moz_quote: "true" } })), true);
    assert.equal(isSkipped(el("DIV", { attrs: { _moz_quote: "true" } })), true);
    assert.equal(isSkipped(el("PRE", { attrs: { _moz_quote: "true" } })), true);
});

test("isSkipped keeps an element that carries no _moz_quote", () => {
    assert.equal(isSkipped(el("SPAN", {}, text("mine"))), false);
    assert.equal(isSkipped(el("SPAN", { attrs: { type: "cite" } })), false);
    // A neighbouring name in the same atom table is not this attribute.
    assert.equal(isSkipped(el("SPAN", { attrs: { _moz_dirty: "" } })), false);
    assert.equal(isSkipped(el("SPAN", { attrs: { moz_quote: "true" } })), false);
    // And a class of that name is not an attribute of that name.
    assert.equal(isSkipped(el("SPAN", { classes: ["_moz_quote"] })), false);
});

test("isSkipped survives an element whose getAttribute is missing", () => {
    // The walk comes from a live document, not from a shape this file controls.
    assert.doesNotThrow(() => isSkipped(bareEl("SPAN")));
    assert.equal(isSkipped(bareEl("SPAN")), false);

    const sent = flatten(el("BODY", {}, bareEl("SPAN", text("still mine"))));

    assert.equal(sent.text, "still mine");
    assert.equal(sent.segments.length, 1);
});

test("a quote span is dropped whole, its several lines and all", () => {
    const sent = flatten(el("BODY", {},
        text("Thanks, that works for me.\n"),
        quote(text("> Bonjour,\n> \n> Can you send the file today?\n> Alice\n")),
    ));

    assert.equal(sent.text, "Thanks, that works for me.\n");
    assert.equal(sent.segments.length, 1);
    assert.ok(!sent.text.includes(">"));
    assert.ok(!sent.text.includes("Bonjour"));
    assert.ok(!sent.text.includes("Alice"));

    // The root of the walk is judged too, not only its children.
    const rootQuote = flatten(quote(text("> Nothing of mine here.\n")));

    assert.equal(rootQuote.text, "");
    assert.equal(rootQuote.segments.length, 0);
});

test("text before and after a dropped quote span is not glued together", () => {
    const sent = flatten(el("BODY", {},
        text("Before the quote."),
        quote(text("> one\n> two\n> three\n")),
        text("After the quote."),
    ));

    assert.equal(sent.text, "Before the quote.\nAfter the quote.");
    assert.ok(!sent.text.includes("Before the quote.After"));
    assert.ok(!sent.text.includes(">"));

    // A quote between two blocks loses its text just the same.
    const betweenBlocks = flatten(el("BODY", {},
        el("P", {}, text("Before.")),
        quote(text("> dropped\n")),
        el("P", {}, text("After.")),
    ));

    assert.equal(betweenBlocks.text, "Before.\nAfter.\n");
});

test("a quote span nested in the user's own markup is still dropped", () => {
    const sent = flatten(el("BODY", {}, el("DIV", {},
        text("What I answer.\n"),
        quote(text("> What they wrote.\n")),
    )));

    assert.equal(sent.text, "What I answer.\n");
    assert.equal(sent.segments.length, 1);
});

test("every segment of a plain text body still slices back out of the text", () => {
    const bodies = [
        el("BODY", {}, text("mine\n"), quote(text("> theirs\n")), text("mine again\n")),
        el("BODY", {}, quote(text("> theirs\n")), text("mine\n")),
        el("BODY", {}, text("before"), quote(text("> a\n> b\n")), text("after")),
        el("BODY", {}, text("On a day, Alice wrote:\n"), quote(text("> a\n")), text("-- \nMe\n")),
    ];

    for (const body of bodies) {
        const sent = flatten(body);
        assert.ok(sent.segments.length > 0);
        for (const segment of sent.segments) {
            assert.equal(sent.text.slice(segment.start, segment.end), segment.node.nodeValue);
            assert.ok(segment.end > segment.start, "a segment covers at least one character");
        }
    }
});

test("beforeSignature drops a signature in the middle and everything after it", () => {
    const given = [block("My answer.", 0), block("-- ", 11), block("Adrien Kara", 15)];

    const kept = beforeSignature(given);

    assert.ok(Array.isArray(kept));
    assert.deepEqual(blocksOf(kept), [{ text: "My answer.", start: 0 }]);
});

test("beforeSignature on a signature at the very start keeps nothing", () => {
    // A signature above the reply is a configuration Thunderbird offers.
    const given = [block("-- ", 0), block("Adrien Kara", 4), block("https://iglou.eu", 16)];

    assert.deepEqual(blocksOf(beforeSignature(given)), []);
});

test("beforeSignature on a signature line at the end drops that line alone", () => {
    const given = [block("One.", 0), block("Two.", 5), block("-- ", 10)];

    assert.deepEqual(blocksOf(beforeSignature(given)), [
        { text: "One.", start: 0 },
        { text: "Two.", start: 5 },
    ]);
});

test("beforeSignature gives the list back as it was when no block is a signature", () => {
    const given = [block("One.", 0), block("Two.", 5), block("Three.", 10)];

    const kept = beforeSignature(given);

    assert.equal(kept.length, 3);
    assert.deepEqual(blocksOf(kept), blocksOf(given));
});

test("the first signature line wins", () => {
    // A reply to a signed message holds the separator twice, and only the first
    // one bounds what the user wrote: cutting at the last would send their own
    // signature to the server.
    const given = [
        block("My answer.", 0),
        block("-- ", 11),
        block("Adrien Kara", 15),
        block("-- ", 27),
        block("Alice", 31),
    ];

    assert.deepEqual(blocksOf(beforeSignature(given)), [{ text: "My answer.", start: 0 }]);
});

test("a block of exactly two hyphens and a space is the signature", () => {
    // Thunderbird writes exactly this line and finds it again as "-- \n", and
    // splitBlocks keeps a block's spaces verbatim, so the trailing space really
    // does reach here.
    const start = after(0, "Mine.");
    const given = [
        block("Mine.", 0),
        block("-- ", start),
        block("Adrien Kara", after(start, "-- ")),
    ];

    assert.deepEqual(blocksOf(beforeSignature(given)), [{ text: "Mine.", start: 0 }]);
});

// Only that exact line cuts. A rule that trimmed first would also swallow a
// bare "--" a user typed themselves, and everything below it would stop being
// checked with nothing to say so. Missing a separator this editor never writes
// is the lesser failure of the two.
for (const [label, line] of [
    ["two hyphens with no trailing space", "--"],
    ["two hyphens with several trailing spaces", "--   "],
    ["two hyphens with a leading space", " -- "],
    ["two hyphens with spaces on both sides", "   --   "],
    ["three hyphens", "---"],
    ["one hyphen", "-"],
    ["two hyphens and a word", "-- Adrien"],
    ["two hyphens glued to a word", "--x"],
    ["two hyphens with a space between them", "- -"],
    ["a sentence holding two hyphens", "It costs 10 -- 20 euros."],
    ["a sentence ending on two hyphens", "And then he said -- "],
]) {
    test(`a block of ${label} is not the signature`, () => {
        const start = after(0, "Mine.");
        const given = [
            block("Mine.", 0),
            block(line, start),
            block("Still mine.", after(start, line)),
        ];

        assert.deepEqual(blocksOf(beforeSignature(given)), blocksOf(given));
    });
}

test("a line of two hyphens the user typed themselves cuts nothing", () => {
    // The whole reason the comparison is strict: a bare "--" is a line people
    // write, and cutting there would silently stop checking the rest.
    const body = el("BODY", {}, text("Two options.\n--\nThe second one.\nAnd a last line.\n"));

    const kept = beforeSignature(splitBlocks(flatten(body).text));

    assert.deepEqual(blocksOf(kept).map((found) => found.text), [
        "Two options.",
        "--",
        "The second one.",
        "And a last line.",
    ]);
});

test("beforeSignature on an empty list gives an empty list", () => {
    const kept = beforeSignature([]);

    assert.ok(Array.isArray(kept));
    assert.deepEqual(blocksOf(kept), []);
});

for (const [label, blocks] of [
    ["undefined", undefined],
    ["null", null],
    ["a string", "-- "],
    ["a number", 3],
    ["true", true],
    ["an object", {}],
    ["a single block rather than a list", block("Mine.", 0)],
    ["a map", new Map([["Mine.", []]])],
    ["a set", new Set([block("Mine.", 0)])],
]) {
    test(`beforeSignature on blocks that are no list (${label}) gives nothing`, () => {
        // The pass must go on whatever it is handed: a check that throws here
        // would leave the compose window without any check at all.
        let kept;
        assert.doesNotThrow(() => {
            kept = beforeSignature(blocks);
        });
        assert.ok(Array.isArray(kept), "expected an array");
        assert.deepEqual(blocksOf(kept), []);
    });
}

test("beforeSignature never touches the list it is given", () => {
    const signature = block("-- ", 11);
    const given = [block("My answer.", 0), signature, block("Adrien Kara", 15)];
    const before = blocksOf(given);

    beforeSignature(given);

    assert.equal(given.length, 3);
    assert.deepEqual(blocksOf(given), before);
    assert.equal(given[1], signature);
});

test("beforeSignature gives back the blocks it was given, not copies", () => {
    const first = block("One.", 0);
    const second = block("Two.", 5);
    const given = [first, second, block("-- ", 10), block("Adrien Kara", 14)];

    const kept = beforeSignature(given);

    // A rebuilt block is a block whose start was measured twice, and a start
    // that drifts from what splitBlocks measured underlines the wrong word.
    assert.equal(kept.length, 2);
    assert.equal(kept[0], first);
    assert.equal(kept[1], second);
});

test("end to end: a plain text reply reaches the server as the user's own lines", () => {
    const mine = text("Thanks, that works for me.\nI will send the file tomorrow.\n");
    const introduction = text("On 2026-09-26 18:45, Alice wrote:\n");
    const quoted = text("> Bonjour,\n> \n> Can you send the file today?\n> Alice\n");
    const signature = text("-- \nAdrien Kara\nhttps://iglou.eu\n");
    // A plain text body holds its text nodes directly, newlines and all: no
    // element wraps a line, and the quote span is the one subtree there is.
    const body = el("BODY", {}, mine, introduction, quote(quoted), signature);

    const sent = flatten(body);
    const kept = beforeSignature(splitBlocks(sent.text));
    const keptTexts = blocksOf(kept).map((found) => found.text);

    assert.deepEqual(keptTexts, [
        "Thanks, that works for me.",
        "I will send the file tomorrow.",
        // The introduction line carries no marker of any kind in this mode, so
        // it stays in the check: one sentence per reply, not a whole thread.
        "On 2026-09-26 18:45, Alice wrote:",
    ]);

    const remaining = keptTexts.join("\n");
    assert.ok(!remaining.includes(">"));
    assert.ok(!remaining.includes("Bonjour"));
    assert.ok(!remaining.includes("today"));
    assert.ok(!remaining.includes("--"));
    assert.ok(!remaining.includes("Adrien Kara"));
    assert.ok(!remaining.includes("iglou.eu"));

    // Every kept block still slices back out of the text that was flattened.
    for (const found of kept) {
        assert.equal(sent.text.slice(found.start, found.start + found.text.length), found.text);
    }

    // An offset in the user's text still lands on the node that holds it, which
    // is what the underline and the right click both rest on.
    const at = sent.text.indexOf("works");
    const found = locate(sent.segments, at, "start");
    assert.ok(found, "expected a node and an offset, got nothing");
    assert.equal(found.node, mine);
    assert.equal(found.offset, mine.nodeValue.indexOf("works"));

    // And a right click inside the quote resolves to no offset at all, so there
    // is nothing to offer a correction for and nothing to write over.
    assert.equal(offsetOf(sent.segments, quoted, 2), null);
});

/**
 * The contract of the way back, in src/compose/body-text.js: `offsetOf`, which turns
 * the place the pointer landed on into an offset in the flattened text, and
 * `matchAt`, which names the error that offset falls inside.
 *
 * `locate` walks from a server offset to the DOM, so the mistake can be
 * underlined. These two walk the other way, so the underlined word can be
 * corrected on a right click. The round trip between them is asserted here: an
 * offset that does not come back to the node it started from would offer the
 * replacements of another word, and applying one would corrupt the message.
 *
 * The published surface of the module is pinned in body-text.test.mjs, with the
 * ten functions that came before these.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { bareEl, el, match, olcBody, text } from "./compose-helpers.mjs";

const { flatten, locate, offsetOf, matchAt } = olcBody;

/** The quote Thunderbird itself inserts when replying. */
const cite = (...children) => el("BLOCKQUOTE", { attrs: { type: "cite" } }, ...children);

const assertLocated = (found, node, offset, label) => {
    assert.ok(found, `expected a node and an offset for ${label}`);
    assert.equal(found.node, node, label);
    assert.equal(found.offset, offset, label);
};

/**
 * Several offsets inside a node of that length, both of its edges included.
 *
 * The edges are where an off by one hides: the start of a node is also the end
 * of the one before it, and the end of a node is a position the caret really
 * reaches, at the end of a word.
 */
const positions = (length) => {
    const offsets = new Set([0, 1, Math.floor(length / 2), length - 1, length]);
    return [...offsets].filter((offset) => offset >= 0 && offset <= length);
};

/** Bodies the round trip must hold for, shapes a compose window really holds. */
const bodies = [
    ["a plain paragraph", () => el("BODY", {}, el("P", {}, text("Hello world.")))],
    ["two paragraphs", () => el("BODY", {},
        el("P", {}, text("First line.")), el("P", {}, text("Second line.")))],
    ["two text nodes glued in one block", () => el("BODY", {},
        el("P", {}, text("ab"), text("cd")))],
    ["three text nodes glued in one block", () => el("BODY", {},
        el("P", {}, text("a"), text("b"), text("c")))],
    ["lines broken by BR", () => el("BODY", {},
        el("DIV", {}, text("one"), el("BR"), text("two"), el("BR"), text("three")))],
    ["a list", () => el("BODY", {},
        el("UL", {}, el("LI", {}, text("first")), el("LI", {}, text("second"))))],
    ["bare text around a dropped quote", () => el("BODY", {},
        text("before"), cite(text("dropped")), text("after"))],
    ["a signature dropped at the end", () => el("BODY", {},
        el("P", {}, text("Regards.")),
        el("PRE", { classes: ["moz-signature"] }, text("-- \nAdrien\n")))],
    ["a node holding newlines of its own", () => el("BODY", {},
        el("DIV", {}, text("line one\nline two")))],
    ["accents and emoji", () => el("BODY", {},
        el("P", {}, text("Une phrase accentuée : déjà vu."), text(" Deux \u{1f600}.")),
        el("P", {}, text("\u{1f389} et voilà.")))],
    ["a paragraph nested in a div", () => el("BODY", {},
        el("DIV", {}, el("P", {}, text("nested")), text("loose")))],
];

test("offsetOf answers the offset inside the first node as is", () => {
    const written = text("Hello world.");

    const sent = flatten(el("BODY", {}, el("P", {}, written)));

    assert.equal(sent.text, "Hello world.\n");
    assert.equal(offsetOf(sent.segments, written, 0), 0);
    assert.equal(offsetOf(sent.segments, written, 6), 6);
});

test("offsetOf answers at the very end of a node's text", () => {
    // Where the caret sits at the end of a word, and where the end of an error
    // falls: a node of twelve characters has a position twelve.
    const written = text("Hello world.");

    const sent = flatten(el("BODY", {}, el("P", {}, written)));

    assert.equal(offsetOf(sent.segments, written, 12), 12);
});

test("offsetOf counts the separator a later node sits after", () => {
    const first = text("one");
    const second = text("two");

    const sent = flatten(el("BODY", {}, el("P", {}, first), el("P", {}, second)));

    assert.equal(sent.text, "one\ntwo\n");
    // Four, not three: the separator belongs to no node, and the second node
    // starts after it.
    assert.equal(offsetOf(sent.segments, second, 0), 4);
    assert.equal(offsetOf(sent.segments, second, 2), 6);
    assert.equal(offsetOf(sent.segments, second, 3), 7);
    assert.equal(sent.text.slice(4, 7), "two");
});

test("offsetOf on two nodes glued in one block: the second starts where the first ends", () => {
    const first = text("ab");
    const second = text("cd");

    const sent = flatten(el("BODY", {}, el("P", {}, first, second)));

    assert.equal(sent.text, "abcd\n");
    assert.equal(offsetOf(sent.segments, first, 2), 2);
    // The same offset for two nodes, which is the boundary locate needs an edge
    // to settle. Going this way the node is given, so there is nothing to tip.
    assert.equal(offsetOf(sent.segments, second, 0), 2);
    assert.equal(offsetOf(sent.segments, second, 2), 4);
});

test("offsetOf on a node the dropped quote pushed down", () => {
    const after = text("After.");

    const sent = flatten(el("BODY", {},
        el("P", {}, text("Before.")),
        cite(el("P", {}, text("What they wrote before."))),
        el("P", {}, after),
    ));

    // The quote left nothing but its separator behind, so the node sits where
    // the flattening put it and not where the body would.
    assert.equal(sent.text, "Before.\nAfter.\n");
    assert.equal(offsetOf(sent.segments, after, 0), 8);
    assert.equal(offsetOf(sent.segments, after, 6), 14);
});

test("offsetOf counts UTF-16 code units, as the server does", () => {
    const first = text("Déjà \u{1f44d}");
    const second = text("vu");

    const sent = flatten(el("BODY", {}, el("P", {}, first), el("P", {}, second)));

    // Six code points, seven code units: counted in code points the second
    // node would start at seven and every offset after the emoji would be
    // shifted by one.
    assert.equal(first.nodeValue.length, 7);
    assert.equal([...first.nodeValue].length, 6);
    assert.equal(offsetOf(sent.segments, first, 5), 5);
    assert.equal(offsetOf(sent.segments, first, 7), 7);
    assert.equal(offsetOf(sent.segments, second, 0), 8);
    assert.equal(sent.text.slice(8, 10), "vu");
});

test("offsetOf returns null for a node no segment covers", () => {
    const dropped = text("What they wrote.");
    const empty = text("");
    const sent = flatten(el("BODY", {},
        el("P", {}, text("Mine."), empty),
        cite(el("P", {}, dropped)),
    ));

    // The text of a quote never left for the server, so no offset of it can be
    // explained, and an empty node was never given a segment either.
    assert.equal(offsetOf(sent.segments, dropped, 0), null);
    assert.equal(offsetOf(sent.segments, empty, 0), null);
    // A node of another document, or of the body as it was before an edit.
    assert.equal(offsetOf(sent.segments, text("never flattened"), 0), null);
    assert.equal(offsetOf([], text("anything"), 0), null);
});

test("offsetOf returns null when the pointer did not land in a text node", () => {
    // caretPositionFromPoint hands back the node the point fell in, which is an
    // element in the gaps of a paragraph, and nothing at all outside the body.
    const paragraph = el("P", {}, text("Hello."));
    const sent = flatten(el("BODY", {}, paragraph));

    assert.equal(offsetOf(sent.segments, paragraph, 0), null);
    assert.equal(offsetOf(sent.segments, bareEl("DIV"), 0), null);
    assert.equal(offsetOf(sent.segments, null, 0), null);
    assert.equal(offsetOf(sent.segments, undefined, 0), null);
});

test("offsetOf returns null for a negative offset", () => {
    const written = text("Hello world.");
    const sent = flatten(el("BODY", {}, el("P", {}, written)));

    assert.equal(offsetOf(sent.segments, written, -1), null);
    assert.equal(offsetOf(sent.segments, written, -12), null);
});

test("offsetOf returns null past the end of the node's own text", () => {
    const written = text("Hello world.");
    const sent = flatten(el("BODY", {},
        el("P", {}, written),
        el("P", {}, text("Second line.")),
    ));

    // Thirteen is a valid offset in the flattened text, inside the paragraph
    // below, so the node's own length is what decides: past it the caller holds
    // a position this flattening cannot explain.
    assert.equal(sent.text.length, 26);
    assert.equal(offsetOf(sent.segments, written, 13), null);
    assert.equal(offsetOf(sent.segments, written, 100), null);
});

test("offsetOf then locate comes back to the node and the offset it started from", () => {
    for (const [label, build] of bodies) {
        const sent = flatten(build());
        assert.ok(sent.segments.length > 0, `${label}: nothing flattened`);

        for (const segment of sent.segments) {
            const node = segment.node;
            const length = node.nodeValue.length;

            for (const offset of positions(length)) {
                const where = `${label}, ${JSON.stringify(node.nodeValue)} at ${offset}`;
                const flat = offsetOf(sent.segments, node, offset);

                assert.equal(flat, segment.start + offset, where);
                if (offset < length) {
                    // The character under the pointer is the character at that
                    // offset of the text the server was given.
                    assert.equal(sent.text[flat], node.nodeValue[offset], where);
                }
                // A boundary between two nodes is one offset for two places, so
                // the edge locate is asked for is the one the position allows:
                // the end of an error tips left, its start tips right.
                if (offset < length) {
                    assertLocated(locate(sent.segments, flat, "start"), node, offset, where);
                }
                if (offset > 0) {
                    assertLocated(locate(sent.segments, flat, "end"), node, offset, where);
                }
            }
        }
    }
});

/** One error over a word of the first paragraph, one over a word of the second. */
const first = match(4, 3, "First problem");
const second = match(10, 4, "Second problem");
const pair = [first, second];

for (const [offset, expected, label] of [
    [-1, null, "before the text"],
    [0, null, "before the first match"],
    [3, null, "the character just before the first match"],
    [4, first, "the first character of the first match"],
    [5, first, "inside the first match"],
    [6, first, "the last character of the first match"],
    [7, null, "the character just after the first match"],
    [8, null, "between the two matches"],
    [9, null, "the character just before the second match"],
    [10, second, "the first character of the second match"],
    [12, second, "inside the second match"],
    [13, second, "the last character of the second match"],
    [14, null, "the character just after the second match"],
    [1000, null, "far past the last match"],
]) {
    test(`matchAt at offset ${offset}, ${label}`, () => {
        // A span starts at its offset and stops before its end, so a click
        // landing exactly where a match ends is on the character after it.
        assert.equal(matchAt(pair, offset), expected);
    });
}

test("matchAt hands back the match itself, not a copy of it", () => {
    // What is found goes to the event page, which builds the menu from its
    // message and its replacements.
    const found = matchAt(pair, 5);

    assert.equal(found, first);
    assert.equal(found.message, "First problem");
});

test("matchAt returns null when there is no match at all", () => {
    assert.equal(matchAt([], 0), null);
    assert.equal(matchAt([], 5), null);
    assert.equal(matchAt([], -1), null);
});

test("matchAt returns the first match of two that cover the same offset", () => {
    // The server does return overlapping rules, and the menu shows one match,
    // so the order it sent them in is what decides.
    const whole = match(0, 10, "The whole phrase");
    const word = match(3, 2, "One word of it");

    assert.equal(matchAt([whole, word], 3), whole);
    assert.equal(matchAt([word, whole], 3), word);
    assert.equal(matchAt([word, whole], 4), word);
    // Outside the narrow one, only the wide one is left to cover the offset.
    assert.equal(matchAt([word, whole], 5), whole);
    assert.equal(matchAt([whole, word], 9), whole);
});

test("a match of length zero covers nothing", () => {
    const nothing = match(5, 0, "Nothing to underline");

    assert.equal(matchAt([nothing], 4), null);
    assert.equal(matchAt([nothing], 5), null);
    assert.equal(matchAt([nothing], 6), null);
});

test("a match of length zero does not hide the one that covers the offset", () => {
    const nothing = match(5, 0, "Nothing to underline");
    const real = match(3, 4, "A real one");

    assert.equal(matchAt([nothing, real], 5), real);
    assert.equal(matchAt([real, nothing], 5), real);
});

for (const [label, offset] of [
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
]) {
    test(`matchAt on an offset that is no finite number (${label}) finds nothing`, () => {
        // The offset comes from a position the browser resolved, so an unusable
        // one is a right click with nothing to offer, never an exception. A
        // numeric string would otherwise compare as the number it looks like.
        assert.doesNotThrow(() => matchAt(pair, offset));
        assert.equal(matchAt(pair, offset), null);
    });
}

test("from a right click on a word to the match that covers it", () => {
    // The path compose.js walks on a contextmenu event: the node and offset the
    // pointer resolved to, the offset in the text the server was given, then the
    // error sitting there.
    const mine = text("I have a cafe.");
    const theirs = text("He manger the apple.");
    const sent = flatten(el("BODY", {}, el("P", {}, mine), el("P", {}, theirs)));
    const cafe = match(sent.text.indexOf("cafe"), 4, "Missing accent");
    const manger = match(sent.text.indexOf("manger"), 6, "Wrong tense");
    const matches = [cafe, manger];
    const at = (node, offset) => matchAt(matches, offsetOf(sent.segments, node, offset));

    assert.equal(at(mine, mine.nodeValue.indexOf("cafe")), cafe);
    assert.equal(at(mine, mine.nodeValue.indexOf("cafe") + 3), cafe);
    assert.equal(at(theirs, theirs.nodeValue.indexOf("manger") + 3), manger);
    // A right click on a word nothing was said about has nothing to offer.
    assert.equal(at(mine, 0), null);
    assert.equal(at(theirs, 0), null);
    // And neither has one on a node that never left for the server.
    assert.equal(at(text("elsewhere"), 0), null);
});

/**
 * The contract of src/compose/body-text.js: what leaves for the server is the text the
 * user wrote, and the segments still point back to the nodes it came from.
 *
 * The quotes and the signature are the bulk of a reply, and none of it is the
 * user's writing, so the size drop is part of the contract and is asserted.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { bareEl, el, olcBody, publishedGlobals, text } from "./compose-helpers.mjs";

const { BLOCK_TAGS, isSkipped, flatten, locate } = olcBody;

/** The quote Thunderbird itself inserts when replying. */
const cite = (...children) => el("BLOCKQUOTE", { attrs: { type: "cite" } }, ...children);

const assertLocated = (found, node, offset) => {
    assert.ok(found, "expected a node and an offset, got nothing");
    assert.equal(found.node, node);
    assert.equal(found.offset, offset);
};

/** Every character the body holds, dropped parts included: the old payload. */
const allText = (node) => (node.nodeValue ?? "").length
    + (node.childNodes ?? []).reduce((total, child) => total + allText(child), 0);

// The API under test lives in the loader's vm realm, so its own arrays never
// match the prototype a strict deep equality compares. These read the values
// back into host ones.
const bounds = (segments) => Array.from(segments, (segment) => `${segment.start}-${segment.end}`);
const nodeValues = (segments) => Array.from(segments, (segment) => segment.node.nodeValue);

test("the API is published on globalThis, and nothing else is", () => {
    assert.deepEqual(publishedGlobals, ["olcBody"]);
    assert.deepEqual(Object.keys(olcBody).sort(), [
        "BLOCK_TAGS", "afterReplacement", "beforeSignature", "blockAt",
        "chunkBlocks", "flatten", "isSkipped", "locate", "matchAt",
        "matchesForBlocks", "missingBlocks", "offsetOf", "outsideFences", "prune",
        "splitBlocks", "splitMatches",
    ]);
});

test("BLOCK_TAGS holds the block tag names in upper case", () => {
    // The set is built in the loader's vm realm, so its identity is not the
    // host's. What counts is the lookup interface flatten needs.
    assert.equal(typeof BLOCK_TAGS.has, "function");
    assert.deepEqual([...BLOCK_TAGS].sort(), [
        "ADDRESS", "BLOCKQUOTE", "BR", "DD", "DIV", "DL", "DT", "H1", "H2",
        "H3", "H4", "H5", "H6", "HR", "LI", "OL", "P", "PRE", "TABLE", "TD",
        "TH", "TR", "UL",
    ]);
    // nodeName comes back upper case, a lower case entry would never match.
    assert.ok(!BLOCK_TAGS.has("p"));
    assert.ok(!BLOCK_TAGS.has("SPAN"));
});

test("a plain paragraph: its text and its single segment", () => {
    const written = text("Hello world.");

    const sent = flatten(el("BODY", {}, el("P", {}, written)));

    assert.equal(sent.text, "Hello world.\n");
    assert.ok(Array.isArray(sent.segments));
    assert.equal(sent.segments.length, 1);
    assert.equal(sent.segments[0].node, written);
    assert.equal(sent.segments[0].start, 0);
    assert.equal(sent.segments[0].end, 12);
});

test("two neighbouring paragraphs are separated by exactly one newline", () => {
    const sent = flatten(el("BODY", {},
        el("P", {}, text("First line.")),
        el("P", {}, text("Second line.")),
    ));

    assert.equal(sent.text, "First line.\nSecond line.\n");
    assert.ok(!sent.text.includes("\n\n"));
    assert.deepEqual(bounds(sent.segments), ["0-11", "12-24"]);
});

test("BR forces a boundary", () => {
    const sent = flatten(el("BODY", {}, el("DIV", {}, text("one"), el("BR"), text("two"))));

    assert.equal(sent.text, "one\ntwo\n");
    assert.deepEqual(bounds(sent.segments), ["0-3", "4-7"]);
});

test("isSkipped recognizes a cited quote, a cite prefix and a signature", () => {
    assert.equal(isSkipped(cite()), true);
    assert.equal(isSkipped(el("DIV", { classes: ["moz-cite-prefix"] })), true);
    assert.equal(isSkipped(el("PRE", { classes: ["moz-signature"] })), true);
    assert.equal(isSkipped(el("DIV", { classes: ["moz-signature", "something"] })), true);
});

test("isSkipped leaves the user's own markup alone", () => {
    assert.equal(isSkipped(el("P", {}, text("mine"))), false);
    // A quote the user typed themselves carries no type attribute.
    assert.equal(isSkipped(el("BLOCKQUOTE", {})), false);
    assert.equal(isSkipped(el("BLOCKQUOTE", { attrs: { type: "normal" } })), false);
    // The type attribute only means a quote on a BLOCKQUOTE.
    assert.equal(isSkipped(el("DIV", { attrs: { type: "cite" } })), false);
    assert.equal(isSkipped(el("DIV", { classes: ["moz-forward-container"] })), false);
});

test("isSkipped survives an element without classList or getAttribute", () => {
    assert.equal(isSkipped(bareEl("DIV")), false);
    assert.equal(isSkipped(bareEl("BLOCKQUOTE")), false);

    const sent = flatten(el("BODY", {}, bareEl("DIV", text("still mine"))));

    assert.equal(sent.text, "still mine\n");
    assert.equal(sent.segments.length, 1);
});

test("a blockquote type=cite is dropped, text and all", () => {
    const sent = flatten(el("BODY", {},
        el("P", {}, text("My answer.")),
        cite(el("P", {}, text("What they wrote before."))),
    ));

    assert.equal(sent.text, "My answer.\n");
    assert.equal(sent.segments.length, 1);
    assert.ok(!sent.text.includes("wrote"));

    // The root is judged too, not only its children.
    const rootQuote = flatten(cite(el("P", {}, text("Nothing of mine here."))));

    assert.equal(rootQuote.text, "");
    assert.equal(rootQuote.segments.length, 0);
});

test("a blockquote without a type attribute is kept", () => {
    const sent = flatten(el("BODY", {}, el("BLOCKQUOTE", {}, text("A quote I make myself."))));

    assert.equal(sent.text, "A quote I make myself.\n");
    assert.equal(sent.segments.length, 1);
});

test("a moz-cite-prefix line and a moz-signature block are dropped", () => {
    const sent = flatten(el("BODY", {},
        el("DIV", { classes: ["moz-cite-prefix"] }, text("On 2026-09-25, someone wrote:"), el("BR")),
        el("P", {}, text("Kept.")),
        el("PRE", { classes: ["moz-signature"] }, text("-- \nAdrien\n")),
    ));

    assert.equal(sent.text, "Kept.\n");
    assert.equal(sent.segments.length, 1);
});

test("a skipped element that is not a block still loses its text", () => {
    const sent = flatten(el("BODY", {}, el("P", {},
        text("Regards, "),
        el("SPAN", { classes: ["moz-signature"] }, text("Adrien Kara")),
    )));

    // Whether a non-block element contributes a separator is not the point
    // here, only that its text never reaches the server.
    assert.ok(!sent.text.includes("Adrien Kara"));
    assert.ok(sent.text.startsWith("Regards, "));
    assert.equal(sent.segments.length, 1);
});

test("text before and after a dropped quote is not glued together", () => {
    const betweenBlocks = flatten(el("BODY", {},
        el("P", {}, text("Before.")),
        cite(el("P", {}, text("Dropped."))),
        el("P", {}, text("After.")),
    ));

    assert.equal(betweenBlocks.text, "Before.\nAfter.\n");

    // The bare case: nothing but the quote stands between the two texts.
    const betweenTexts = flatten(el("BODY", {},
        text("Before."),
        cite(text("Dropped.")),
        text("After."),
    ));

    assert.equal(betweenTexts.text, "Before.\nAfter.");
    assert.ok(!betweenTexts.text.includes("Before.After."));
});

test("a signature nested in a dropped quote is dropped with it", () => {
    const sent = flatten(el("BODY", {},
        el("P", {}, text("Mine.")),
        cite(
            el("P", {}, text("Theirs.")),
            el("PRE", { classes: ["moz-signature"] }, text("-- \nThem\n")),
        ),
        el("P", {}, text("Also mine.")),
    ));

    assert.equal(sent.text, "Mine.\nAlso mine.\n");
    assert.deepEqual(bounds(sent.segments), ["0-5", "6-16"]);
});

test("nested quotes are dropped whole", () => {
    const sent = flatten(el("BODY", {},
        el("P", {}, text("Mine.")),
        cite(
            el("P", {}, text("Level one.")),
            el("DIV", { classes: ["moz-cite-prefix"] }, text("On an earlier day, wrote:")),
            cite(el("P", {}, text("Level two."))),
        ),
    ));

    assert.equal(sent.text, "Mine.\n");
    assert.deepEqual(nodeValues(sent.segments), ["Mine."]);
});

test("a cited quote inside a quote the user kept is still dropped", () => {
    const sent = flatten(el("BODY", {}, el("BLOCKQUOTE", {},
        text("What I chose to quote."),
        cite(text("What the mailer quoted.")),
    )));

    assert.equal(sent.text, "What I chose to quote.\n");
    assert.equal(sent.segments.length, 1);
});

test("every segment maps back to the value of its node", () => {
    const bodies = [
        el("BODY", {}, el("P", {}, text("one"), text(" and two")), el("P", {}, text("three"))),
        el("BODY", {}, text("before"), cite(text("dropped")), text("after")),
        el("BODY", {}, el("DIV", {}, text("a"), el("BR"), text("b"), el("BR"), text("c"))),
        el("BODY", {}, el("UL", {}, el("LI", {}, text("first")), el("LI", {}, text("second")))),
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

test("an empty body and empty text nodes produce nothing", () => {
    const emptyBody = flatten(el("BODY"));

    assert.equal(emptyBody.text, "");
    assert.equal(emptyBody.segments.length, 0);

    // A block holding nothing must not open the text with a separator.
    const onlyEmptyText = flatten(el("BODY", {}, el("P", {}, text("")), el("P", {}, text(""))));

    assert.equal(onlyEmptyText.text, "");
    assert.equal(onlyEmptyText.segments.length, 0);

    const around = flatten(el("BODY", {}, el("P", {}, text(""), text("real"), text(""))));

    assert.equal(around.text, "real\n");
    assert.equal(around.segments.length, 1);
    assert.equal(around.segments[0].start, 0);
    assert.equal(around.segments[0].end, 4);
});

test("locate finds both edges of a segment", () => {
    const sent = flatten(el("BODY", {}, el("P", {}, text("one")), el("P", {}, text("two"))));
    const [first, second] = sent.segments;

    assert.equal(sent.text, "one\ntwo\n");
    assertLocated(locate(sent.segments, 0, "start"), first.node, 0);
    assertLocated(locate(sent.segments, 3, "end"), first.node, 3);
    assertLocated(locate(sent.segments, 4, "start"), second.node, 0);
    assertLocated(locate(sent.segments, 7, "end"), second.node, 3);
});

test("locate tips a boundary between two segments according to the edge", () => {
    // Two text nodes glued in one block: the offset belongs to both.
    const sent = flatten(el("BODY", {}, el("P", {}, text("ab"), text("cd"))));
    const [first, second] = sent.segments;

    assert.equal(sent.text, "abcd\n");
    assertLocated(locate(sent.segments, 2, "start"), second.node, 0);
    assertLocated(locate(sent.segments, 2, "end"), first.node, 2);
});

test("locate returns null on a separator, which belongs to no node", () => {
    const sent = flatten(el("BODY", {}, el("P", {}, text("one")), el("P", {}, text("two"))));

    assert.equal(sent.text, "one\ntwo\n");
    assert.equal(locate(sent.segments, 3, "start"), null);
    assert.equal(locate(sent.segments, 4, "end"), null);
    // Nothing starts before the first character either.
    assert.equal(locate(sent.segments, 0, "end"), null);
});

test("locate returns null out of range", () => {
    const sent = flatten(el("BODY", {}, el("P", {}, text("one"))));
    const past = sent.text.length + 10;

    assert.equal(locate(sent.segments, past, "start"), null);
    assert.equal(locate(sent.segments, past, "end"), null);
    assert.equal(locate(sent.segments, -1, "start"), null);
    assert.equal(locate(sent.segments, -1, "end"), null);
    assert.equal(locate([], 0, "start"), null);
    assert.equal(locate([], 0, "end"), null);
});

test("a realistic Thunderbird reply: only the user's text is sent", () => {
    const mine = ["Thanks, that works for me.", "I will send the file tomorrow."];
    const filler = ("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod "
        + "tempor incididunt ut labore et dolore magna aliqua. ").repeat(3);

    // Ten exchanges, each quoting the one before: the thread the extension used
    // to send in full to have three lines corrected.
    const quoted = (level) => {
        const children = [el("P", {}, text(`Message ${level}. ${filler}`))];
        if (level > 1) {
            children.push(el("DIV", { classes: ["moz-cite-prefix"] },
                text(`On day ${level - 1}, sender ${level - 1} wrote:`), el("BR")));
            children.push(quoted(level - 1));
        }
        return cite(...children);
    };

    const body = el("BODY", {},
        el("P", {}, text(mine[0])),
        el("P", {}, text(mine[1])),
        el("DIV", { classes: ["moz-cite-prefix"] },
            text("On 2026-09-25 18:12, Someone wrote:"), el("BR")),
        quoted(10),
    );

    const sent = flatten(body);

    assert.equal(sent.text, `${mine[0]}\n${mine[1]}\n`);
    assert.deepEqual(nodeValues(sent.segments), mine);
    assert.ok(!sent.text.includes("Lorem"));
    assert.ok(!sent.text.includes("Message"));
    assert.ok(!sent.text.includes("wrote:"));

    const whole = allText(body);
    assert.ok(whole > 3000, `expected a long thread, got ${whole} characters`);
    assert.ok(
        sent.text.length * 40 < whole,
        `sent ${sent.text.length} characters of ${whole}, not the drop this change is for`,
    );
});

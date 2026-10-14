/**
 * The contract of code in the body: it is not prose, so it never reaches the
 * server, and the text around it is still checked with offsets that land on the
 * right word.
 *
 * Code is mostly identifiers, commands and punctuation, often not in the
 * language of the message, and a server reading it as prose flags nearly every
 * line of it. It comes in two shapes, and each one goes through the mechanism
 * the quote and the signature already use.
 *
 * Code marked up in HTML is a subtree to skip, like a quote. Thunderbird's Code
 * text style writes a `<code>` inside the paragraph, and its Preformat paragraph
 * format writes a `<pre>` whose lines are split by `<br>`. The plain text mode
 * writes no `<pre>` at all: its body is the root, its lines split by `<br>` too,
 * so skipping `<pre>` cannot swallow a plain text message.
 *
 * Code typed between two Markdown fences is a run of lines to drop, like the
 * plain text signature, because no element marks it in either mode: each fence
 * is a paragraph of its own in HTML and a line between two `<br>` in plain text.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { assertSpans, bareEl, block, blocksOf, el, match, olcBody, text } from "./compose-helpers.mjs";

const {
    isSkipped, flatten, locate, offsetOf, splitBlocks, beforeSignature, outsideFences,
    matchesForBlocks,
} = olcBody;

/** The quote Thunderbird itself inserts when replying in HTML. */
const cite = (...children) => el("BLOCKQUOTE", { attrs: { type: "cite" } }, ...children);

/** The quote Thunderbird wraps the quoted message in, in plain text mode. */
const quote = (...children) => el("SPAN", { attrs: { _moz_quote: "true" } }, ...children);

/** One paragraph per line, which is how the HTML editor holds what is typed. */
const paragraphs = (...lines) => el("BODY", {}, ...lines.map((line) => el("P", {}, text(line))));

/** One text node per line between `<br>`, which is how the plain text editor holds it. */
const plainLines = (...lines) => el("BODY", {}, ...lines.flatMap((line) => [text(line), el("BR")]));

/** The texts of the blocks left once the fenced code is dropped. */
const keptTexts = (body) => blocksOf(outsideFences(splitBlocks(flatten(body).text)))
    .map((found) => found.text);

/** The blocks of a text given line by line, so a test reads like the message. */
const blocksOfLines = (...lines) => splitBlocks(`${lines.join("\n")}\n`);

// ---------------------------------------------------------------- HTML code

test("isSkipped recognizes the two elements code is written in", () => {
    assert.equal(isSkipped(el("CODE")), true);
    assert.equal(isSkipped(el("PRE")), true);
    // Whatever they carry: the tag is the whole signal.
    assert.equal(isSkipped(el("CODE", { attrs: { _moz_dirty: "" } })), true);
    assert.equal(isSkipped(el("PRE", { classes: ["something"] })), true);
});

test("isSkipped recognizes code on an element without classList or getAttribute", () => {
    // The walk comes from a live document, not from a shape this file controls.
    assert.equal(isSkipped(bareEl("CODE")), true);
    assert.equal(isSkipped(bareEl("PRE")), true);
});

test("isSkipped keeps what only looks like code", () => {
    // The Fixed Width font is a typeface, not a statement that the text is code.
    assert.equal(isSkipped(el("TT", {}, text("mine"))), false);
    assert.equal(isSkipped(el("SPAN", { classes: ["code"] }, text("mine"))), false);
    assert.equal(isSkipped(el("DIV", { attrs: { type: "code" } }, text("mine"))), false);
    assert.equal(isSkipped(el("P", {}, text("```"))), false);
});

test("inline code in the middle of a paragraph is dropped, the sentence around it kept", () => {
    const before = text("Call ");
    const after = text(" before the loop.");
    const sent = flatten(el("BODY", {}, el("P", {}, before, el("CODE", {}, text("getUser()")), after)));

    assert.equal(sent.text, "Call \n before the loop.\n");
    assert.ok(!sent.text.includes("getUser"));
    // A line break where the code was, never the two spaces glued together,
    // which the server reads as a typo of the user's.
    assert.ok(!sent.text.includes("  "));
    assert.deepEqual(Array.from(sent.segments, (segment) => segment.node), [before, after]);
});

test("a mistake after inline code still lands on its own word", () => {
    const after = text(" before the lop.");
    const sent = flatten(el("BODY", {}, el("P", {},
        text("Call "), el("CODE", {}, text("getUser()")), after)));
    const blocks = splitBlocks(sent.text);

    assert.deepEqual(blocksOf(blocks), [
        { text: "Call ", start: 0 },
        { text: " before the lop.", start: 6 },
    ]);

    const found = matchesForBlocks(blocks, new Map([[" before the lop.", [match(12, 3)]]]));

    assert.equal(found.length, 1);
    assertSpans(sent, found[0], after, 12, 15);
});

test("inline code opening or closing a paragraph leaves no stray separator", () => {
    const opening = flatten(el("BODY", {},
        el("P", {}, el("CODE", {}, text("useState")), text(" returns a pair.")),
    ));

    assert.equal(opening.text, " returns a pair.\n");

    const closing = flatten(el("BODY", {},
        el("P", {}, text("Then run "), el("CODE", {}, text("npm test"))),
        el("P", {}, text("Next paragraph.")),
    ));

    assert.equal(closing.text, "Then run \nNext paragraph.\n");
});

test("code nested in other markup, and markup nested in code, are dropped whole", () => {
    const inBold = flatten(el("BODY", {}, el("P", {},
        el("B", {}, text("Bold "), el("CODE", {}, text("x")), text(" still bold.")),
    )));

    assert.equal(inBold.text, "Bold \n still bold.\n");

    const holdingBold = flatten(el("BODY", {}, el("P", {},
        text("Keep "), el("CODE", {}, el("B", {}, text("bold code")), text(" more code")), text(" this."),
    )));

    assert.equal(holdingBold.text, "Keep \n this.\n");
    assert.ok(!holdingBold.text.includes("code"));

    // The shape a pasted page or a forwarded message brings in.
    const codeInPre = flatten(el("BODY", {},
        el("P", {}, text("Before.")),
        el("PRE", {}, el("CODE", {}, text("const a = 1;\nconst b = 2;\n"))),
        el("P", {}, text("After.")),
    ));

    assert.equal(codeInPre.text, "Before.\nAfter.\n");
});

test("a Preformat paragraph is dropped, its lines and all, and the next one still maps back", () => {
    const after = text("After the code.");
    const sent = flatten(el("BODY", {},
        el("P", {}, text("Before the code.")),
        el("PRE", {}, text("for x in y:"), el("BR"), text("    print(x)"), el("BR")),
        el("P", {}, after),
    ));

    assert.equal(sent.text, "Before the code.\nAfter the code.\n");
    assert.equal(offsetOf(sent.segments, after, 6), 23);
    const found = locate(sent.segments, 23, "start");
    assert.equal(found.node, after);
    assert.equal(found.offset, 6);
});

test("code in a quote goes with the quote, code in the user's own quote is dropped alone", () => {
    const cited = flatten(el("BODY", {},
        el("P", {}, text("Mine.")),
        cite(el("P", {}, text("Call "), el("CODE", {}, text("x()")), text(" first."))),
    ));

    assert.equal(cited.text, "Mine.\n");

    // A blockquote with no type is one the user made, and its prose is theirs.
    const ownQuote = flatten(el("BODY", {}, el("BLOCKQUOTE", {},
        text("As the doc says, "), el("CODE", {}, text("x()")), text(" comes first."),
    )));

    assert.equal(ownQuote.text, "As the doc says, \n comes first.\n");
});

// ---------------------------------------------------------- Markdown fences

test("a fenced block is dropped with both fences, the lines around it kept in place", () => {
    const sent = flatten(paragraphs(
        "Here is the fix.",
        "```",
        "const user = await getUserById(id);",
        "```",
        "Tell me if it works.",
    ));
    const kept = outsideFences(splitBlocks(sent.text));

    assert.deepEqual(blocksOf(kept), [
        { text: "Here is the fix.", start: 0 },
        { text: "Tell me if it works.", start: 61 },
    ]);
    // A dropped block must not move the ones after it.
    for (const found of kept) {
        assert.equal(sent.text.slice(found.start, found.start + found.text.length), found.text);
    }
});

test("the opening fence may name the language of the code", () => {
    for (const opening of ["```js", "```python", "``` js", "```c++", "```shell session"]) {
        assert.deepEqual(
            blocksOf(outsideFences(blocksOfLines("Before.", opening, "code", "```", "After.")))
                .map((found) => found.text),
            ["Before.", "After."],
            opening,
        );
    }
});

test("a fence left open runs to the end of what the user wrote", () => {
    // As in CommonMark. Ending it anywhere else would be a guess, and checking
    // the rest of the code is the very noise this filter is there to remove.
    assert.deepEqual(keptTexts(paragraphs(
        "Before.",
        "```js",
        "const a = 1;",
        "still code, never closed",
    )), ["Before."]);
});

test("two fenced blocks in a row keep the prose between them", () => {
    assert.deepEqual(keptTexts(paragraphs(
        "First.",
        "```",
        "one",
        "```",
        "Between.",
        "```sql",
        "select 1;",
        "```",
        "Last.",
    )), ["First.", "Between.", "Last."]);
});

test("a fence may be indented and followed by spaces, no-break ones included", () => {
    // The HTML editor turns the spaces it is typed with into no-break ones.
    assert.deepEqual(keptTexts(paragraphs(
        "Before.",
        "  ```js",
        "code",
        "``` ",
        "After.",
    )), ["Before.", "After."]);

    assert.deepEqual(keptTexts(paragraphs("Before.", "  ```  ", "code", "\t```", "After.")), [
        "Before.",
        "After.",
    ]);
});

test("four backticks fence a block too", () => {
    assert.deepEqual(keptTexts(paragraphs("Before.", "````", "code", "````", "After.")), [
        "Before.",
        "After.",
    ]);
});

test("a line naming a language inside a fenced block does not close it", () => {
    // A closing fence carries nothing but backticks, as in CommonMark, so this
    // line is code and the block still ends on the next bare fence.
    assert.deepEqual(keptTexts(paragraphs(
        "Before.",
        "```",
        "```js",
        "still code",
        "```",
        "After.",
    )), ["Before.", "After."]);
});

// A rule loose enough to open a fence on any line holding backticks would
// silently stop checking the rest of the message, and nothing would say why.
for (const [label, line] of [
    ["two backticks", "``"],
    ["inline code", "Use `npm test` here."],
    ["a fence after words", "See this ```"],
    ["inline code between triple backticks", "```js```"],
    ["a sentence holding a fence", "Type ```js on its own line."],
    ["a tilde fence, which is out of reach", "~~~"],
    ["three quotes", "'''"],
]) {
    test(`a line of ${label} is no fence`, () => {
        const given = blocksOfLines("Before.", line, "Middle.", "```", "After.");

        // The bare fence further down opens a block of its own and drops what
        // follows it, so only the line under test decides what Middle. becomes.
        assert.deepEqual(blocksOf(outsideFences(given)).map((found) => found.text), [
            "Before.",
            line,
            "Middle.",
        ]);
    });
}

test("fences typed in a plain text message are dropped the same way", () => {
    assert.deepEqual(keptTexts(plainLines(
        "One line before.",
        "```js",
        "const a = 1;",
        "```",
        "One line after.",
    )), ["One line before.", "One line after."]);
});

test("fences pasted as one paragraph of lines are dropped the same way", () => {
    // What a paste becomes in the HTML editor: one paragraph, its lines split by <br>.
    const body = el("BODY", {}, el("P", {},
        text("pasted line"), el("BR"), text("```"), el("BR"), text("pasted code"), el("BR"),
        text("```"), el("BR"), text("pasted line after"),
    ));

    assert.deepEqual(keptTexts(body), ["pasted line", "pasted line after"]);
});

test("a fence inside a quote leaves the user's text after the quote alone", () => {
    // The quote never reaches the text, so a fence it holds, closed or not, has
    // nothing to open.
    assert.deepEqual(keptTexts(el("BODY", {},
        el("P", {}, text("Mine before.")),
        cite(el("P", {}, text("```")), el("P", {}, text("their code"))),
        el("P", {}, text("Mine after.")),
    )), ["Mine before.", "Mine after."]);

    assert.deepEqual(keptTexts(el("BODY", {},
        text("Mine before."), el("BR"),
        quote(text("> ```js"), el("BR"), text("> their code"), el("BR")),
        text("Mine after."), el("BR"),
    )), ["Mine before.", "Mine after."]);
});

test("end to end: a mistake after a fenced block lands on its own word", () => {
    const after = text("Tell me if it wroks.");
    const body = el("BODY", {},
        el("P", {}, text("Here is the fix.")),
        el("P", {}, text("```js")),
        el("P", {}, text("const user = await getUserById(id);")),
        el("P", {}, text("```")),
        el("P", {}, after),
    );

    const sent = flatten(body);
    const kept = outsideFences(splitBlocks(sent.text));
    const cache = new Map([
        ["Here is the fix.", []],
        ["Tell me if it wroks.", [match(14, 5)]],
    ]);

    const found = matchesForBlocks(kept, cache);

    assert.equal(found.length, 1);
    assertSpans(sent, found[0], after, 14, 19);
});

test("dropping the fences first keeps a signature line written as code from cutting the message", () => {
    // An SQL comment can be exactly the plain text signature separator, and
    // inside a fence it is code, not the end of what the user wrote.
    const blocks = blocksOfLines("Run this.", "```sql", "-- ", "select 1;", "```", "Then tell me.");

    assert.deepEqual(blocksOf(beforeSignature(outsideFences(blocks))).map((found) => found.text), [
        "Run this.",
        "Then tell me.",
    ]);
});

test("outsideFences gives the list back as it was when there is no fence", () => {
    const given = blocksOfLines("One.", "Two.", "Three.");

    assert.deepEqual(blocksOf(outsideFences(given)), blocksOf(given));
});

test("outsideFences gives back the blocks it was given, not copies", () => {
    const first = block("Before.", 0);
    const last = block("After.", 22);
    const given = [first, block("```", 8), block("code", 12), block("```", 17), last];

    const kept = outsideFences(given);

    // A rebuilt block is a block whose start was measured twice, and a start
    // that drifts from what splitBlocks measured underlines the wrong word.
    assert.equal(kept.length, 2);
    assert.equal(kept[0], first);
    assert.equal(kept[1], last);
});

test("outsideFences never touches the list it is given", () => {
    const given = [block("Before.", 0), block("```", 8), block("code", 12)];
    const before = blocksOf(given);

    outsideFences(given);

    assert.equal(given.length, 3);
    assert.deepEqual(blocksOf(given), before);
});

test("outsideFences on an empty list gives an empty list", () => {
    const kept = outsideFences([]);

    assert.ok(Array.isArray(kept));
    assert.deepEqual(blocksOf(kept), []);
});

for (const [label, blocks] of [
    ["undefined", undefined],
    ["null", null],
    ["a string", "```"],
    ["a number", 3],
    ["an object", {}],
    ["a single block rather than a list", block("```", 0)],
    ["a set", new Set([block("Mine.", 0)])],
]) {
    test(`outsideFences on blocks that are no list (${label}) gives nothing`, () => {
        // The pass must go on whatever it is handed: a check that throws here
        // would leave the compose window without any check at all.
        let kept;
        assert.doesNotThrow(() => {
            kept = outsideFences(blocks);
        });
        assert.ok(Array.isArray(kept), "expected an array");
        assert.deepEqual(blocksOf(kept), []);
    });
}

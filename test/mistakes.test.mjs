/**
 * The contract of src/list/mistakes.js: what the window that lists the mistakes
 * of a message shows for one of them, where the reader is left once one is
 * corrected and once the message has changed behind them, and where the page it
 * is all shown in sits.
 *
 * A module with no Thunderbird API and no DOM, so all of it is provable under
 * Node where no window exists. The page itself is left with reading the answer
 * and building the list.
 *
 * Seven rules carry it. The extract is the text the mistake sits in, cut around it,
 * because a list is read away from the message and a word alone says nothing
 * about where it is. It stops at the separator the compose side puts between two
 * blocks, or the end of one paragraph would be glued to the start of the next and
 * read as a sentence nobody wrote. What the cutting took away is marked, and only
 * where the cutting is what ended the extract, so a reader is never sent looking
 * for words their message does not hold. The count is of what the correction
 * would touch, which is the span the mistake covers and never what a replacement
 * writes, a deletion included. The place a correction leaves the reader on is the
 * one they were at, bounded by the list that came back, because the mistake that
 * was resolved is gone from it and the next one has taken its place. The place a
 * list arriving on its own leaves them on is the mistake they were reading and not
 * the number it was at, since a mistake fixed or made before it moves every
 * number after it. And nothing here throws: the mistakes arrive as a message from
 * another context, so one that describes nothing costs its own row and never the
 * whole window.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
    CONTEXT,
    ELLIPSIS,
    PAGE,
    TAB_PARAMETER,
    extractOf,
    placeAfter,
    placeKept,
} from "../src/list/mistakes.js";
import { srcDir } from "./helpers.mjs";

/**
 * A message of three paragraphs, as the compose side flattens one: the blocks
 * joined by the separator it puts between them.
 *
 * Written here and not captured, because nothing in it comes from the server: a
 * fixture under test/fixtures is a real answer, and this is the text a human
 * types. The middle paragraph is longer than twice the context on purpose, so a
 * mistake in it is cut by the context and not by the paragraph.
 */
const BODY = [
    "Hier je suis aller a la mer.",
    "Nous avons mangé des glaces et nous avons nagé toute la journée durant sans jamais nous plaindre.",
    "Merci merci et bientot",
].join("\n");

/** The separator between two blocks, which is what bounds an extract. */
const SEPARATOR = "\n";

/**
 * The span one word of the body occupies, so no offset in this file is counted
 * by hand.
 *
 * `needle` is a run of text that appears once, and `word` the part of it the
 * mistake covers, which is how a single character is named without naming every
 * other place that letter appears.
 */
function spanOf(needle, word = needle) {
    const at = BODY.indexOf(needle);
    return { offset: at + needle.indexOf(word), length: word.length };
}

/**
 * A mistake as the compose window answers one: a match painted by the event
 * page, plus the covered text.
 *
 * Everything but the offset and the length is there although the extract has no
 * use for it, because that is how a mistake really arrives, and a function
 * reading more than it needs is what this file is here to catch.
 */
const mistakeOn = (needle, word = needle, replacements = ["corrigé"]) => ({
    ...spanOf(needle, word),
    text: word,
    message: "Cette phrase demande un participe passé.",
    replacements,
    ruleId: "PARTICIPE_PASSE",
    label: "Grammaire",
    color: "#d35400",
    family: "grammar",
    choices: replacements.map((value) => ({ value, text: value, struck: false })),
});

/**
 * Every extract the list has to show, with the before, the after and the marks
 * spelled out.
 *
 * Literal and never derived, because an expectation computed the way the module
 * computes it would prove nothing about either.
 */
const EVERY_EXTRACT = [
    [
        "at the very start of the message",
        mistakeOn("Hier"),
        {
            before: "",
            covered: "Hier",
            after: " je suis aller a la mer.",
            characters: 4,
            opening: "",
            closing: "",
        },
    ],
    [
        "at the very end of the message",
        mistakeOn("bientot"),
        {
            before: "Merci merci et ",
            covered: "bientot",
            after: "",
            characters: 7,
            opening: "",
            closing: "",
        },
    ],
    [
        "covering a single character",
        mistakeOn(" a ", "a"),
        {
            before: "Hier je suis aller ",
            covered: "a",
            after: " la mer.",
            characters: 1,
            opening: "",
            closing: "",
        },
    ],
    [
        "spanning several words",
        mistakeOn("aller a la"),
        {
            before: "Hier je suis ",
            covered: "aller a la",
            after: " mer.",
            characters: 10,
            opening: "",
            closing: "",
        },
    ],
    [
        "whose replacement is a deletion",
        mistakeOn("merci ", "merci ", [""]),
        {
            before: "Merci ",
            covered: "merci ",
            after: "et bientot",
            characters: 6,
            opening: "",
            closing: "",
        },
    ],
    [
        "with more than the context on either side",
        mistakeOn("toute"),
        {
            before: "des glaces et nous avons nagé ",
            covered: "toute",
            after: " la journée durant sans jamais",
            characters: 5,
            opening: ELLIPSIS,
            closing: ELLIPSIS,
        },
    ],
    [
        "at the start of a paragraph that is not the start of the message",
        mistakeOn("Nous"),
        {
            before: "",
            covered: "Nous",
            after: " avons mangé des glaces et nou",
            characters: 4,
            opening: "",
            closing: ELLIPSIS,
        },
    ],
    [
        "at the end of a paragraph that is not the end of the message",
        mistakeOn("plaindre."),
        {
            before: "urnée durant sans jamais nous ",
            covered: "plaindre.",
            after: "",
            characters: 9,
            opening: ELLIPSIS,
            closing: "",
        },
    ],
];

/**
 * Every mistake that describes no span of this body, and every body that is no
 * text.
 *
 * The window reads what another context reported, so a span pointing outside the
 * message is the ordinary case of a message that has moved on, and never a
 * reason to throw.
 */
const EVERY_EMPTY = [
    ["a mistake that is null", BODY, null],
    ["a mistake that is undefined", BODY, undefined],
    ["a mistake that is a number", BODY, 7],
    ["a mistake that is a string", BODY, "aller"],
    ["a mistake that is an array", BODY, [{ offset: 0, length: 4 }]],
    ["an offset that is missing", BODY, { length: 4 }],
    ["a length that is missing", BODY, { offset: 0 }],
    ["an offset that is negative", BODY, { offset: -1, length: 4 }],
    ["a length that is negative", BODY, { offset: 4, length: -2 }],
    ["an offset that is not whole", BODY, { offset: 1.5, length: 4 }],
    ["a length that is not whole", BODY, { offset: 0, length: 2.5 }],
    ["an offset that is no number", BODY, { offset: "0", length: 4 }],
    ["a length that is no number", BODY, { offset: 0, length: "4" }],
    ["an offset past the end of the message", BODY, { offset: BODY.length + 1, length: 1 }],
    ["a span reaching past the end of the message", BODY, { offset: BODY.length - 2, length: 5 }],
    ["a body that is empty", "", { offset: 0, length: 1 }],
    ["a body that is null", null, { offset: 0, length: 4 }],
    ["a body that is undefined", undefined, { offset: 0, length: 4 }],
    ["a body that is a number", 42, { offset: 0, length: 4 }],
    ["a body that is an array", ["Hier"], { offset: 0, length: 4 }],
];

/** What a mistake describing no span of the body is shown as. */
const NOTHING = {
    before: "",
    covered: "",
    after: "",
    characters: 0,
    opening: "",
    closing: "",
};

/**
 * Where a correction leaves the reader, each case written as the list it was
 * asked of: the place resolved, how many mistakes came back, and where that
 * leaves them.
 */
const EVERY_PLACE = [
    ["resolving the first of seven", 0, 6, 0],
    ["resolving the third of seven", 2, 6, 2],
    ["resolving the last of seven", 6, 6, 5],
    ["resolving the only one there was", 0, 0, null],
    ["a refresh that came back empty", 3, 0, null],
    ["a refresh that came back shorter than the place", 5, 3, 2],
    ["a refresh that came back longer than the list was", 2, 9, 2],
];

/** Every list there is nowhere to stand in. */
const EVERY_NO_PLACE = [
    ["a list holding nothing", 3, 0],
    ["a count that is negative", 3, -1],
    ["a count that is not whole", 3, 2.5],
    ["a count that is no number", 3, "4"],
    ["a count that is missing", 3, undefined],
    ["a count that is null", 3, null],
];

/** Every place that is no place, which the first row answers. */
const EVERY_NO_ONE = [
    ["a place that is negative", -1, 5],
    ["a place that is not whole", 1.5, 5],
    ["a place that is no number", "2", 5],
    ["a place that is missing", undefined, 5],
    ["a place that is null", null, 5],
];

/**
 * The list the reader is walking, as the compose window answers one: four
 * mistakes of the message, in the order of the text.
 *
 * Four different spans, so each one is its own mistake under the only comparison
 * that carries across a change of the message: the rule and the text covered.
 */
const READING = [
    mistakeOn("aller a la", "aller"),
    mistakeOn(" a ", "a"),
    mistakeOn("merci ", "merci "),
    mistakeOn("bientot"),
];

/** One mistake of the same message that the list being read does not hold. */
const APPEARED = mistakeOn("Hier");

/** The list with the mistake the reader was on taken out of it. */
const WITHOUT_THE_THIRD = [READING[0], READING[1], READING[3]];

/**
 * Where a list arriving on its own leaves the reader, each case written as they
 * live it: the list they were reading, the place they stood at, the list that
 * arrived, and the place that leaves them on.
 *
 * The place expected is spelled out and never computed, because an expectation
 * worked out the way the module works it out would prove nothing about either.
 */
const EVERY_KEPT = [
    ["a list that did not change", READING, 2, READING, 2],
    [
        "a mistake fixed by hand before the one being read",
        READING, 2, [READING[0], READING[2], READING[3]], 1,
    ],
    [
        "a mistake fixed by hand after the one being read",
        READING, 1, WITHOUT_THE_THIRD, 1,
    ],
    [
        "a mistake made by hand before the one being read",
        READING, 2, [APPEARED, ...READING], 3,
    ],
    [
        "a mistake made by hand after the one being read",
        READING, 1, [...READING, APPEARED], 1,
    ],
    [
        "the mistake being read fixed by hand",
        READING, 2, WITHOUT_THE_THIRD, 2,
    ],
    [
        "the last mistake being read fixed by hand",
        READING, 3, [READING[0], READING[1], READING[2]], 2,
    ],
    [
        "a list that shrank past the place and left the mistake behind",
        READING, 3, [READING[0]], 0,
    ],
    ["a list that arrived empty", READING, 2, [], null],
    [
        "a list arriving for a reader who was standing nowhere",
        [], null, READING, 0,
    ],
];

/**
 * Everything the reader could be standing on that names no mistake, and every
 * list that is no list.
 *
 * The page reads what another context reported, so a standing mistake that
 * describes nothing is the ordinary case of a window that has just opened or of a
 * message that has moved on, and the place then falls back on the number.
 */
const EVERY_NOTHING_STOOD_ON = [
    ["a mistake that is null", null, READING, 2, 2],
    ["a mistake that is undefined", undefined, READING, 2, 2],
    ["a mistake that is a number", 7, READING, 2, 2],
    ["a mistake that is a string", "aller", READING, 2, 2],
    ["a mistake carrying no text", { ruleId: "PARTICIPE_PASSE" }, READING, 2, 2],
    ["a mistake whose text is no text", { text: 42 }, READING, 2, 2],
    ["a list that is no array", READING[2], "aller", 2, null],
    ["a list that is null", READING[2], null, 2, null],
    ["a list that is undefined", READING[2], undefined, 2, null],
];

for (const [label, mistake, expected] of EVERY_EXTRACT) {
    test(`the extract of a mistake ${label}`, () => {
        assert.deepEqual(extractOf(BODY, mistake), expected);
    });

    test(`the extract of a mistake ${label} is the body's own text`, () => {
        // Cut from the message and never rebuilt from the covered text the
        // compose side sent: the three pieces read in a row are what the writer
        // will find in their message, at the place the correction will land. The
        // marks are kept out of them for the same reason, and travel apart.
        const { before, covered, after } = extractOf(BODY, mistake);
        const at = BODY.indexOf(before + covered + after);

        assert.notEqual(at, -1, `${before}${covered}${after}`);
        assert.equal(at + before.length, mistake.offset);
    });
}

for (const [label, body, mistake] of EVERY_EMPTY) {
    test(`a mistake describing nothing shows nothing (${label})`, () => {
        assert.doesNotThrow(() => extractOf(body, mistake));
        assert.deepEqual(extractOf(body, mistake), NOTHING);
    });
}

test("neither side of the extract is longer than the context", () => {
    // The row is read at a glance, so the context is what makes the mistake
    // recognisable and never a second copy of the paragraph.
    for (let offset = 0; offset < BODY.length; offset += 1) {
        const { before, after } = extractOf(BODY, { offset, length: 1 });

        assert.ok(before.length <= CONTEXT, `${offset}: ${before.length} before`);
        assert.ok(after.length <= CONTEXT, `${offset}: ${after.length} after`);
    }
});

test("no extract crosses the separator between two blocks", () => {
    // A context that ran over it would show the end of one paragraph against the
    // start of the next, as a sentence the writer never wrote.
    for (let offset = 0; offset < BODY.length; offset += 1) {
        const { before, covered, after } = extractOf(BODY, { offset, length: 1 });

        assert.equal(before.includes(SEPARATOR), false, `${offset} before`);
        assert.equal(after.includes(SEPARATOR), false, `${offset} after`);
        assert.equal(covered, BODY.slice(offset, offset + 1));
    }
});

test("a mark stands where the context cut the text, and nowhere else", () => {
    // A paragraph that ended before the context did left nothing out, and a mark
    // there would have the reader look for words their message does not hold. A
    // side that was cut always shows the whole context, so that is what says one
    // was.
    for (let offset = 0; offset < BODY.length; offset += 1) {
        const { before, after, opening, closing } = extractOf(BODY, { offset, length: 1 });

        assert.ok(opening === "" || opening === ELLIPSIS, `${offset}: ${opening}`);
        assert.ok(closing === "" || closing === ELLIPSIS, `${offset}: ${closing}`);
        if (opening === ELLIPSIS) {
            assert.equal(before.length, CONTEXT, `${offset} before`);
        }
        if (closing === ELLIPSIS) {
            assert.equal(after.length, CONTEXT, `${offset} after`);
        }
    }
});

test("the mark is one character, so a cut costs the extract almost no room", () => {
    assert.equal([...ELLIPSIS].length, 1);
});

test("the count is of the covered span, whatever the replacement writes", () => {
    // What the correction touches is the text it is written over. A deletion
    // writes nothing and still takes those characters away, so a count read from
    // the replacement would say a deletion touches nothing at all.
    const span = spanOf("merci ");

    for (const replacements of [[""], ["merci"], ["merci beaucoup "], []]) {
        const { characters } = extractOf(BODY, { ...span, replacements });

        assert.equal(characters, span.length, JSON.stringify(replacements));
    }
});

test("the count is in characters a reader counts, not in the units an offset is in", () => {
    // An offset is in UTF-16 code units, where an emoji is two of them, and a
    // row saying a correction touches two characters where one is on screen
    // states a number nobody can check.
    const body = "Bravo 👍👍 a tous";
    const thumbs = body.indexOf("👍");

    assert.deepEqual(extractOf(body, { offset: thumbs, length: 4 }), {
        before: "Bravo ",
        covered: "👍👍",
        after: " a tous",
        characters: 2,
        opening: "",
        closing: "",
    });
});

test("extractOf leaves the mistake it was given alone", () => {
    // The page keeps that mistake to write the correction with, so an extract
    // that edited it would apply something else than what the server reported.
    const mistake = mistakeOn("aller a la");
    const before = structuredClone(mistake);

    extractOf(BODY, mistake);

    assert.deepEqual(mistake, before);
});

for (const [label, resolved, remaining, expected] of EVERY_PLACE) {
    test(`the place left by ${label}`, () => {
        assert.equal(placeAfter(resolved, remaining), expected);
    });
}

for (const [label, resolved, remaining] of EVERY_NO_PLACE) {
    test(`there is nowhere to stand in ${label}`, () => {
        assert.doesNotThrow(() => placeAfter(resolved, remaining));
        assert.equal(placeAfter(resolved, remaining), null);
    });
}

for (const [label, resolved, remaining] of EVERY_NO_ONE) {
    test(`the first row answers ${label}`, () => {
        assert.doesNotThrow(() => placeAfter(resolved, remaining));
        assert.equal(placeAfter(resolved, remaining), 0);
    });
}

test("a step off either end of the list stays on the list", () => {
    // The arrow keys ask the same question as a correction does: a place, bounded
    // by what the list holds. A step that ran off either end would take the
    // keyboard out of the list the window exists to walk.
    assert.equal(placeAfter(-1, 4), 0);
    assert.equal(placeAfter(4, 4), 3);
});

test("resolving one mistake never sends the reader backwards past the next", () => {
    // Everything after the resolved one has moved up by exactly one, so the place
    // it held is where the next one now is. Anything smaller would offer a
    // mistake that was already passed, and anything larger would skip one.
    const seven = 7;

    for (let resolved = 0; resolved < seven; resolved += 1) {
        const left = placeAfter(resolved, seven - 1);

        assert.equal(left, Math.min(resolved, seven - 2), `resolved ${resolved}`);
    }
});

for (const [label, reading, was, arrived, expected] of EVERY_KEPT) {
    test(`the place kept across ${label}`, () => {
        assert.equal(placeKept(reading[was], arrived, was), expected);
    });
}

for (const [label, standing, arrived, was, expected] of EVERY_NOTHING_STOOD_ON) {
    test(`the place falls back on the number for ${label}`, () => {
        assert.doesNotThrow(() => placeKept(standing, arrived, was));
        assert.equal(placeKept(standing, arrived, was), expected);
    });
}

test("a list that came back the same leaves the reader on the very mistake they were on", () => {
    // The list arrives again after every pass, most of them changing nothing at
    // all, and a reader moved by one of those would be moved for nothing.
    for (const [was, mistake] of READING.entries()) {
        const kept = placeKept(mistake, READING, was);

        assert.equal(kept, was, `${was}: ${mistake.text}`);
    }
});

test("a mistake found again where it moved to, and not where its number was", () => {
    // The whole reason the mistake and not the number is followed: every number
    // after a mistake fixed by hand has moved by one, and a reader held at theirs
    // would be aiming at the mistake that took its place.
    const arrived = [READING[1], READING[2], READING[3]];

    assert.equal(placeKept(READING[3], arrived, 3), 2);
    assert.equal(placeKept(READING[2], arrived, 2), 1);
});

test("a word flagged twice by one rule keeps the reader on the nearer of the two", () => {
    // Two rows carrying the same rule and the same text are the same mistake made
    // twice, and nothing tells them apart. The nearer one is where the reader was
    // aiming, and a tie goes to the earlier, the list being read from the top.
    const twice = [READING[2], READING[0], READING[2]];

    assert.equal(placeKept(READING[2], twice, 2), 2);
    assert.equal(placeKept(READING[2], twice, 0), 0);
    assert.equal(placeKept(READING[2], twice, 1), 0);
});

test("a mistake whose rule differs is another mistake, whatever text it covers", () => {
    // The rule is half of what says a mistake is the same one, so the same word
    // flagged by another rule is another row, with another explanation and other
    // replacements behind it.
    const renamed = { ...READING[2], ruleId: "FRENCH_WHITESPACE" };

    assert.equal(placeKept(READING[2], [READING[0], renamed], 2), 1);
    assert.equal(placeKept(READING[2], [READING[0], renamed, READING[2]], 2), 2);
});

test("placeKept leaves the list and the mistake it was given alone", () => {
    // The page keeps both to draw the rows and to write the corrections with, so
    // a placement that edited either would correct something else than what the
    // server reported.
    const arrived = [...READING];
    const before = structuredClone({ standing: READING[2], arrived });

    placeKept(READING[2], arrived, 2);

    assert.deepEqual({ standing: READING[2], arrived }, before);
});

test("the page the window opens is a file the extension ships", () => {
    // src/manifest.json never names it, because a page opened with
    // `windows.create` is declared nowhere, so the walk of the manifest in
    // test/manifest.test.mjs cannot cover it. A path that resolves to nothing
    // opens an empty window with no error anywhere, which is what this catches
    // instead.
    assert.ok(existsSync(join(srcDir, PAGE)), `no packaged file named ${PAGE}`);
});

test("the page is named by a strict relative path, which is the form getURL takes", () => {
    assert.equal(PAGE.startsWith("/"), false, PAGE);
    assert.match(PAGE, /\.html$/);
});

test("the compose window travels under a name both sides can put in a URL", () => {
    // The event page writes it into the URL it opens the window with and the page
    // reads it back from there, so it is declared once and read from here by
    // both.
    assert.equal(typeof TAB_PARAMETER, "string");
    assert.equal(encodeURIComponent(TAB_PARAMETER), TAB_PARAMETER);
});

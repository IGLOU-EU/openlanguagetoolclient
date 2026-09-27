/**
 * The contract of src/badge.js: what the compose window's action button says
 * about a check, read from the state the compose script sends.
 *
 * The mapping is asserted against the exported colour constants and never
 * against hex strings, so repainting the palette does not rewrite these tests.
 * One test, and one only, pins the palette itself.
 *
 * The button says two things at once. The badge gives the number of mistakes,
 * in two characters and no more, which is what the badge really holds. The
 * label, shown beside the icon because the compose toolbar displays it, gives
 * the language the message is checked in.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { BADGE_ERRORS, BADGE_PENDING, BADGE_TEXT, badgeFor } from "../src/badge.js";

/** The keys a badge carries, sorted the way Object.keys gives them back. */
const BADGE_KEYS = ["background", "label", "text", "textColor", "title"];

/**
 * What the badge holds: twenty pixels of width at a ten pixel font.
 *
 * A third character overflows by about a pixel and gets its edges shaved, and a
 * fourth is cut with no ellipsis, so nothing longer than this ever reaches it.
 */
const BADGE_WIDTH = 2;

/**
 * The pending text, U+2026 HORIZONTAL ELLIPSIS.
 *
 * Spelled by its code point because three full stops are indistinguishable
 * from it in a source file and are not the same badge.
 */
const ELLIPSIS = "…";

const CHECKING = "Checking";
const NOTHING_FOUND = "No mistake found";
const UNREACHABLE = "LanguageTool could not be reached";

/**
 * Every shape badgeFor has to answer, the rows of the mapping and the values
 * that are no state at all. The state crosses a message boundary, so a shape
 * nobody meant to send is the ordinary case here, not an exotic one.
 */
const EVERY_SHAPE = [
    ["busy", { busy: true }],
    ["failed", { failed: true }],
    ["a clean pass", { errors: 0 }],
    ["one mistake", { errors: 1 }],
    ["seven mistakes", { errors: 7 }],
    ["a count above the cap", { errors: 250 }],
    ["a count and a language", { errors: 3, language: "fr" }],
    ["a count above the cap and a variant", { errors: 250, language: "pt-BR" }],
    ["busy in a known language", { busy: true, language: "en-US" }],
    ["failed in a known language", { failed: true, language: "de-DE" }],
    ["a language that is no string", { errors: 3, language: 42 }],
    ["an empty object", {}],
    ["undefined", undefined],
    ["null", null],
    ["a number", 3],
    ["a string", "busy"],
    ["an array", [1]],
];

/** The badge of a pass that found nothing, which is also the badge of every default. */
function assertNothingFound(badge) {
    assert.equal(badge.text, "");
    assert.equal(badge.background, BADGE_PENDING);
    assert.equal(badge.textColor, BADGE_TEXT);
    assert.equal(badge.title, NOTHING_FOUND);
    // No state of this shape names a language, and an empty label is what hands
    // the button back to its title.
    assert.equal(badge.label, "");
}

test("the palette is the one the extension paints with", () => {
    // The only test that spells the colours out, so a palette change is decided
    // here and nowhere else.
    assert.equal(BADGE_PENDING, "#6b7280");
    assert.equal(BADGE_ERRORS, "#c0392b");
    assert.equal(BADGE_TEXT, "#ffffff");
});

test("busy: an ellipsis on the pending colour", () => {
    const badge = badgeFor({ busy: true, errors: 0, failed: false });

    assert.equal(badge.text, ELLIPSIS);
    // One character, so three full stops cannot pass for the ellipsis.
    assert.equal(badge.text.length, 1);
    assert.equal(badge.background, BADGE_PENDING);
    assert.equal(badge.textColor, BADGE_TEXT);
    assert.equal(badge.title, CHECKING);
});

test("a finished pass that failed: an exclamation mark on the pending colour", () => {
    const badge = badgeFor({ busy: false, errors: 0, failed: true });

    assert.equal(badge.text, "!");
    // A server that could not be reached is not a mistake in the message, so it
    // does not get the error colour.
    assert.equal(badge.background, BADGE_PENDING);
    assert.equal(badge.textColor, BADGE_TEXT);
    assert.equal(badge.title, UNREACHABLE);
});

test("a finished pass with nothing to report: an empty text, which is what clears the badge", () => {
    const badge = badgeFor({ busy: false, errors: 0, failed: false });

    assert.equal(badge.text, "");
    assert.equal(badge.background, BADGE_PENDING);
    assert.equal(badge.textColor, BADGE_TEXT);
    assert.equal(badge.title, NOTHING_FOUND);
});

test("a finished pass with one mistake: the count on the error colour", () => {
    const badge = badgeFor({ busy: false, errors: 1, failed: false });

    assert.equal(badge.text, "1");
    assert.equal(badge.background, BADGE_ERRORS);
    assert.equal(badge.textColor, BADGE_TEXT);
    assert.equal(badge.title, "1 mistake");
});

test("a finished pass with several mistakes: the count on the error colour", () => {
    const badge = badgeFor({ busy: false, errors: 12, failed: false });

    assert.equal(badge.text, "12");
    assert.equal(badge.background, BADGE_ERRORS);
    assert.equal(badge.textColor, BADGE_TEXT);
    assert.equal(badge.title, "12 mistakes");
});

test("a count above ninety nine is capped in the text and kept whole in the title", () => {
    const badge = badgeFor({ busy: false, errors: 250, failed: false });

    // The badge is a few pixels wide, the tooltip is not. A third character is
    // cut rather than shown, so the cap has no room for a plus sign.
    assert.equal(badge.text, "99");
    assert.equal(badge.background, BADGE_ERRORS);
    assert.equal(badge.textColor, BADGE_TEXT);
    assert.equal(badge.title, "250 mistakes");
});

test("the cap is a cap on the text alone, and the true count stays in the title", () => {
    // Whoever hovers the button wants the real number, and a tooltip has room
    // for it. A capped title would lose a count nothing else reports.
    for (const [errors, title] of [
        [100, "100 mistakes"],
        [250, "250 mistakes"],
        [4321, "4321 mistakes"],
    ]) {
        const badge = badgeFor({ busy: false, errors, failed: false });

        assert.equal(badge.text, "99");
        assert.equal(badge.title, title);
    }
});

test("busy wins over a failed pass", () => {
    const badge = badgeFor({ busy: true, failed: true });

    assert.equal(badge.text, ELLIPSIS);
    assert.equal(badge.background, BADGE_PENDING);
    assert.equal(badge.title, CHECKING);
});

test("busy wins over a count", () => {
    const badge = badgeFor({ busy: true, errors: 4 });

    assert.equal(badge.text, ELLIPSIS);
    assert.equal(badge.background, BADGE_PENDING);
    assert.equal(badge.title, CHECKING);
});

test("busy wins over a failed pass and a capped count at once", () => {
    const badge = badgeFor({ busy: true, errors: 250, failed: true });

    assert.equal(badge.text, ELLIPSIS);
    assert.equal(badge.background, BADGE_PENDING);
    assert.equal(badge.title, CHECKING);
});

test("a failed pass wins over a count", () => {
    // The count is the one from the pass before, and a pass that never answered
    // says nothing about the message being written now.
    const badge = badgeFor({ busy: false, errors: 7, failed: true });

    assert.equal(badge.text, "!");
    assert.equal(badge.background, BADGE_PENDING);
    assert.equal(badge.title, UNREACHABLE);
});

test("a failed pass wins over a capped count", () => {
    const badge = badgeFor({ busy: false, errors: 250, failed: true });

    assert.equal(badge.text, "!");
    assert.equal(badge.background, BADGE_PENDING);
    assert.equal(badge.title, UNREACHABLE);
});

test("a failed pass with no count is still a failure, not a clean pass", () => {
    const badge = badgeFor({ busy: false, errors: 0, failed: true });

    assert.equal(badge.text, "!");
    assert.equal(badge.title, UNREACHABLE);
});

for (const [errors, text, background] of [
    [0, "", BADGE_PENDING],
    [1, "1", BADGE_ERRORS],
    [2, "2", BADGE_ERRORS],
    [98, "98", BADGE_ERRORS],
    [99, "99", BADGE_ERRORS],
    [100, "99", BADGE_ERRORS],
    [250, "99", BADGE_ERRORS],
]) {
    test(`a count of ${errors} shows ${JSON.stringify(text)}`, () => {
        const badge = badgeFor({ busy: false, errors, failed: false });

        // Ninety nine still fits, a hundred is where the cap starts, and past it
        // the text stops changing.
        assert.equal(badge.text, text);
        assert.equal(badge.background, background);
        assert.equal(badge.textColor, BADGE_TEXT);
    });
}

for (const [errors, title] of [
    [0, NOTHING_FOUND],
    [1, "1 mistake"],
    [2, "2 mistakes"],
    [98, "98 mistakes"],
    [99, "99 mistakes"],
    [100, "100 mistakes"],
    [250, "250 mistakes"],
]) {
    test(`a count of ${errors} is titled ${JSON.stringify(title)}`, () => {
        assert.equal(badgeFor({ busy: false, errors, failed: false }).title, title);
    });
}

test("the title is singular at exactly one mistake and plural at two", () => {
    assert.equal(badgeFor({ errors: 1 }).title, "1 mistake");
    assert.equal(badgeFor({ errors: 2 }).title, "2 mistakes");
});

test("a state that only carries busy defaults the two others", () => {
    const badge = badgeFor({ busy: true });

    assert.equal(badge.text, ELLIPSIS);
    assert.equal(badge.background, BADGE_PENDING);
    assert.equal(badge.title, CHECKING);
});

test("a state that only carries a count defaults busy and failed", () => {
    const badge = badgeFor({ errors: 3 });

    assert.equal(badge.text, "3");
    assert.equal(badge.background, BADGE_ERRORS);
    assert.equal(badge.title, "3 mistakes");
});

test("a state that only carries failed defaults busy and the count", () => {
    const badge = badgeFor({ failed: true });

    assert.equal(badge.text, "!");
    assert.equal(badge.background, BADGE_PENDING);
    assert.equal(badge.title, UNREACHABLE);
});

test("an empty object is read as a finished pass with nothing found", () => {
    assertNothingFound(badgeFor({}));
});

test("a state with every field spelled out false and zero is the same as an empty one", () => {
    assert.deepEqual(badgeFor({ busy: false, errors: 0, failed: false }), badgeFor({}));
});

test("an unknown field is ignored rather than read as a state", () => {
    assert.deepEqual(badgeFor({ pending: true, count: 42, error: true }), badgeFor({}));
});

test("called with no state at all, it still answers a badge", () => {
    assertNothingFound(badgeFor());
});

for (const [label, state] of [
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["zero", 0],
    ["NaN", NaN],
    ["a string", "busy"],
    ["an empty string", ""],
    ["an array", [1, 2, 3]],
    ["an empty array", []],
    ["true", true],
    ["false", false],
]) {
    test(`a state that is no object at all (${label}) is read as every default`, () => {
        // It arrives as a message from another context, so an unusable state is
        // a badge to draw and never an exception to throw.
        assert.doesNotThrow(() => badgeFor(state));
        assertNothingFound(badgeFor(state));
    });
}

for (const [label, errors] of [
    ["minus one", -1],
    ["a large negative count", -250],
    ["a numeric string", "3"],
    ["a numeric string above the cap", "250"],
    ["an empty string", ""],
    ["a word", "many"],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["minus Infinity", -Infinity],
    ["null", null],
    ["true", true],
    ["an object", {}],
    ["an empty array", []],
    ["an array holding a number", [5]],
]) {
    test(`a count that is no usable number (${label}) is read as zero`, () => {
        assert.doesNotThrow(() => badgeFor({ busy: false, errors, failed: false }));
        assertNothingFound(badgeFor({ busy: false, errors, failed: false }));
    });
}

for (const [label, language, expected] of [
    ["a plain code", "fr", "FR"],
    ["a variant code", "en-US", "EN-US"],
    ["another variant code", "pt-BR", "PT-BR"],
    ["a code already upper cased", "DE", "DE"],
    ["a code in mixed case", "en-us", "EN-US"],
]) {
    test(`the label is the language in force, upper cased (${label})`, () => {
        // The label is the only place the language is readable without clicking,
        // and upper case is what tells it apart from a word of the toolbar.
        assert.equal(badgeFor({ busy: false, errors: 3, language }).label, expected);
    });
}

for (const [label, language] of [
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["an empty string", ""],
    ["spaces", "   "],
    ["true", true],
    ["an object", {}],
    ["an array", ["fr"]],
]) {
    test(`a language that names nothing (${label}) leaves the label empty`, () => {
        // An empty label is not a blank one: it is what makes the button fall
        // back to its title, which always says something.
        assert.equal(badgeFor({ busy: false, errors: 3, language }).label, "");
    });
}

test("a state that says nothing about the language leaves the label empty", () => {
    assert.equal(badgeFor({ busy: false, errors: 3, failed: false }).label, "");
});

for (const [label, state] of [
    ["busy", { busy: true, language: "fr" }],
    ["a failed pass", { failed: true, language: "fr" }],
    ["a clean pass", { errors: 0, language: "fr" }],
    ["a count", { errors: 3, language: "fr" }],
    ["a count above the cap", { errors: 250, language: "fr" }],
]) {
    test(`the label carries the language whatever the check is doing (${label})`, () => {
        // The language in force does not change because a pass is running or
        // failed, and a label that came and went would flicker on every check.
        assert.equal(badgeFor(state).label, "FR");
    });
}

test("busy with no language known carries no label", () => {
    // Nothing is known yet, so the button says what it is doing through its
    // title rather than showing a caption that names nothing.
    assert.equal(badgeFor({ busy: true }).label, "");
    assert.equal(badgeFor({ busy: true, errors: 0, failed: false }).label, "");
});

test("the language is a label and never reaches the badge or the title", () => {
    // The badge counts mistakes and the title explains them, so a language
    // landing in either would overwrite what the reader is looking for.
    const badge = badgeFor({ busy: false, errors: 3, language: "fr" });

    assert.equal(badge.text, "3");
    assert.equal(badge.title, "3 mistakes");
});

test("an unusable count does not survive as a title either", () => {
    // A tooltip reading "NaN mistakes" or "Infinity mistakes" would be worse
    // than no tooltip at all.
    for (const errors of [NaN, Infinity, -1, "3", null]) {
        const badge = badgeFor({ errors });

        assert.equal(badge.title, NOTHING_FOUND);
        assert.equal(badge.text, "");
    }
});

for (const [label, state] of EVERY_SHAPE) {
    test(`a badge carries the five contract keys and nothing else (${label})`, () => {
        assert.deepEqual(Object.keys(badgeFor(state)).sort(), BADGE_KEYS);
    });

    test(`the text is a string and the text colour never varies (${label})`, () => {
        const badge = badgeFor(state);

        // The text goes straight to a badge, where a number is not a caption.
        assert.equal(typeof badge.text, "string");
        assert.equal(typeof badge.title, "string");
        assert.equal(typeof badge.label, "string");
        assert.equal(badge.textColor, BADGE_TEXT);
    });

    test(`the text never asks the badge for more room than it has (${label})`, () => {
        const badge = badgeFor(state);

        assert.ok(badge.text.length <= BADGE_WIDTH, JSON.stringify(badge.text));
    });

    test(`the title always says something, whatever the badge shows (${label})`, () => {
        // An empty badge and an empty label both fall back to the title, so it
        // is the one thing that can never be blank.
        assert.notEqual(badgeFor(state).title, "");
    });
}

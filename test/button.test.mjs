/**
 * The contract of src/button.js: what the compose window's action button says
 * about a check, read from the state the compose script sends.
 *
 * The button says three things at once. The icon gives the state of the check,
 * which is the logo when the pass ran and a ring holding a wait or an alert when
 * it did not. The badge gives the number of mistakes, in two characters and no
 * more, which is what the badge really holds. The label, shown beside the icon
 * because the compose toolbar displays it, gives the language the message is
 * checked in. The title says in words what none of the three has room for, the
 * exact count included.
 *
 * The colours are asserted against the exported constants and never against hex
 * strings, so repainting the badge does not rewrite these tests. One test, and
 * one only, pins the palette itself.
 *
 * The icons are files packaged with the extension, so their names are spelled
 * out here rather than computed: the mapping is what these tests exist to pin,
 * and a test that derives it would agree with any mistake the module makes.
 * Every path the module can answer is opened all the same, since a path that
 * resolves to nothing is an invisible button. Their pictures are held against
 * `test/icons.mjs`, the shape they were drawn from, which makes the committed
 * files golden ones: an icon redrawn by hand fails here instead of shipping as a
 * shape nobody described.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BADGE_BACKGROUND, BADGE_TEXT, BUSY_MARK, STATE_ICONS, buttonFor } from "../src/button.js";
import { RING_COLOR, ringIcon } from "./icons.mjs";

/** Where the packaged icons sit, which is the directory the extension is built from. */
const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** The keys a button carries, sorted the way Object.keys gives them back. */
const BUTTON_KEYS = ["background", "icon", "label", "text", "textColor", "title"];

/** The logo, which is the wavy line alone and the one icon drawn by hand. */
const LOGO = "icon.svg";

const BUSY = "icon-busy.svg";
const ALERT = "icon-alert.svg";

/**
 * How many characters the badge holds, which is what the width `src/button.js`
 * measures comes to.
 *
 * Held for every shape, because the platform refuses nothing here: a text too
 * long is shaved at both ends and no call says it was.
 */
const BADGE_WIDTH = 2;

/**
 * What the badge shows past the last count that fits, U+221E CAP_MARK.
 *
 * One glyph, where `99+` is three and does not fit. It claims no number at all,
 * which a badge reading `99` for a hundred and twenty one mistakes would, and
 * the title is where the real count is read.
 */
const CAP_MARK = "+";

const CHECKING = "Checking";
const NOTHING_FOUND = "No mistake found";
const UNREACHABLE = "LanguageTool could not be reached";

/**
 * Every shape buttonFor has to answer, the rows of the mapping and the values
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

/** The button of a pass that found nothing, which is also the button of every default. */
function assertNothingFound(button) {
    assert.equal(button.icon, LOGO);
    assert.equal(button.text, "");
    assert.equal(button.title, NOTHING_FOUND);
    // No state of this shape names a language, and an empty label is what hands
    // the button back to its title.
    assert.equal(button.label, "");
}

test("the palette is the one the badge is painted with", () => {
    // The only test that spells the colours out, so a palette change is decided
    // here and nowhere else.
    assert.equal(BADGE_BACKGROUND, "#c0392b");
    assert.equal(BADGE_TEXT, "#ffffff");
});

test("busy: the ring that breathes, and nothing in the badge", () => {
    const button = buttonFor({ busy: true, errors: 0, failed: false });

    assert.equal(button.icon, BUSY);
    assert.equal(button.text, "");
    assert.equal(button.title, CHECKING);
});

test("a finished pass that failed: the ring with an alert in it, and nothing in the badge", () => {
    const button = buttonFor({ busy: false, errors: 0, failed: true });

    // A server that could not be reached is not a mistake in the message, so it
    // does not wear a count.
    assert.equal(button.icon, ALERT);
    assert.equal(button.text, "");
    assert.equal(button.title, UNREACHABLE);
});

test("a finished pass with nothing to report: the logo, and no badge at all", () => {
    const button = buttonFor({ busy: false, errors: 0, failed: false });

    assert.equal(button.icon, LOGO);
    assert.equal(button.text, "");
    assert.equal(button.title, NOTHING_FOUND);
});

test("a finished pass with one mistake: the logo, and the count in the badge", () => {
    const button = buttonFor({ busy: false, errors: 1, failed: false });

    assert.equal(button.icon, LOGO);
    assert.equal(button.text, "1");
    assert.equal(button.background, BADGE_BACKGROUND);
    assert.equal(button.textColor, BADGE_TEXT);
    assert.equal(button.title, "1 mistake");
});

test("a finished pass with several mistakes: the count in the badge", () => {
    const button = buttonFor({ busy: false, errors: 12, failed: false });

    assert.equal(button.icon, LOGO);
    assert.equal(button.text, "12");
    assert.equal(button.title, "12 mistakes");
});

test("a count above what the badge holds shows the cap mark and keeps the title whole", () => {
    const button = buttonFor({ busy: false, errors: 250, failed: false });

    // The badge is two characters wide, the tooltip is not.
    assert.equal(button.text, CAP_MARK);
    assert.equal(button.icon, LOGO);
    assert.equal(button.title, "250 mistakes");
});

test("the cap is a cap on the badge alone, and the true count stays in the title", () => {
    // Whoever hovers the button wants the real number, and a tooltip has room
    // for it. A capped title would lose a count nothing else reports.
    for (const [errors, title] of [
        [100, "100 mistakes"],
        [250, "250 mistakes"],
        [4321, "4321 mistakes"],
    ]) {
        const button = buttonFor({ busy: false, errors, failed: false });

        assert.equal(button.text, CAP_MARK);
        assert.equal(button.title, title);
    }
});

test("ninety nine still counts and a hundred no longer does", () => {
    // Pinned by hand because it is the one row of the mapping a sweep could
    // agree with the module about while both are wrong.
    assert.equal(buttonFor({ errors: 99 }).text, "99");
    assert.equal(buttonFor({ errors: 100 }).text, CAP_MARK);
});

test("busy wins over a failed pass", () => {
    const button = buttonFor({ busy: true, failed: true });

    assert.equal(button.icon, BUSY);
    assert.equal(button.text, "");
    assert.equal(button.title, CHECKING);
});

test("busy wins over a count", () => {
    const button = buttonFor({ busy: true, errors: 4 });

    assert.equal(button.icon, BUSY);
    assert.equal(button.text, "");
    assert.equal(button.title, CHECKING);
});

test("busy wins over a failed pass and a capped count at once", () => {
    const button = buttonFor({ busy: true, errors: 250, failed: true });

    assert.equal(button.icon, BUSY);
    assert.equal(button.text, "");
    assert.equal(button.title, CHECKING);
});

test("a failed pass wins over a count", () => {
    // The count is the one from the pass before, and a pass that never answered
    // says nothing about the message being written now.
    const button = buttonFor({ busy: false, errors: 7, failed: true });

    assert.equal(button.icon, ALERT);
    assert.equal(button.text, "");
    assert.equal(button.title, UNREACHABLE);
});

test("a failed pass wins over a capped count", () => {
    const button = buttonFor({ busy: false, errors: 250, failed: true });

    assert.equal(button.icon, ALERT);
    assert.equal(button.text, "");
    assert.equal(button.title, UNREACHABLE);
});

test("a failed pass with no count is still a failure, not a clean pass", () => {
    const button = buttonFor({ busy: false, errors: 0, failed: true });

    assert.equal(button.icon, ALERT);
    assert.equal(button.title, UNREACHABLE);
});

for (const [label, state] of [
    ["busy", { busy: true }],
    ["a failed pass", { failed: true }],
    ["a clean pass", { errors: 0 }],
    ["busy over a count", { busy: true, errors: 7 }],
    ["a failed pass over a count", { failed: true, errors: 7 }],
]) {
    test(`a state that is not a count carries no badge at all (${label})`, () => {
        // The icon already says what happened, and a badge left standing beside
        // it would go on counting the pass before.
        assert.equal(buttonFor(state).text, "");
    });
}

for (const [errors, text] of [
    [0, ""],
    [1, "1"],
    [2, "2"],
    [9, "9"],
    [10, "10"],
    [98, "98"],
    [99, "99"],
    [100, CAP_MARK],
    [101, CAP_MARK],
    [250, CAP_MARK],
    [4321, CAP_MARK],
]) {
    test(`a count of ${errors} shows ${JSON.stringify(text)}`, () => {
        const button = buttonFor({ busy: false, errors, failed: false });

        // Ninety nine still fits, a hundred is where the cap starts, and past it
        // the badge stops changing.
        assert.equal(button.text, text);
        assert.equal(button.icon, LOGO);
        assert.equal(button.textColor, BADGE_TEXT);
    });
}

test("every count from none to past the cap keeps the logo and counts in the badge", () => {
    // Swept rather than listed: a hundred and twenty rows written out would be
    // a hundred and twenty chances to mistype one, and the count is the whole of
    // what the badge is for. The icon never moves with it, a count being a
    // finished pass whatever it found.
    for (let errors = 0; errors <= 120; errors += 1) {
        const { icon, text } = buttonFor({ errors });

        assert.equal(icon, LOGO, String(errors));
        if (errors === 0) {
            assert.equal(text, "", String(errors));
        } else if (errors <= 99) {
            assert.equal(text, String(errors), String(errors));
        } else {
            assert.equal(text, CAP_MARK, String(errors));
        }
    }
});

for (const [errors, title] of [
    [0, NOTHING_FOUND],
    [1, "1 mistake"],
    [2, "2 mistakes"],
    [9, "9 mistakes"],
    [10, "10 mistakes"],
    [98, "98 mistakes"],
    [99, "99 mistakes"],
    [100, "100 mistakes"],
    [250, "250 mistakes"],
]) {
    test(`a count of ${errors} is titled ${JSON.stringify(title)}`, () => {
        assert.equal(buttonFor({ busy: false, errors, failed: false }).title, title);
    });
}

test("the title is singular at exactly one mistake and plural at two", () => {
    assert.equal(buttonFor({ errors: 1 }).title, "1 mistake");
    assert.equal(buttonFor({ errors: 2 }).title, "2 mistakes");
});

test("a state that only carries busy defaults the two others", () => {
    const button = buttonFor({ busy: true });

    assert.equal(button.icon, BUSY);
    assert.equal(button.text, "");
    assert.equal(button.title, CHECKING);
});

test("a state that only carries a count defaults busy and failed", () => {
    const button = buttonFor({ errors: 3 });

    assert.equal(button.icon, LOGO);
    assert.equal(button.text, "3");
    assert.equal(button.title, "3 mistakes");
});

test("a state that only carries failed defaults busy and the count", () => {
    const button = buttonFor({ failed: true });

    assert.equal(button.icon, ALERT);
    assert.equal(button.text, "");
    assert.equal(button.title, UNREACHABLE);
});

test("an empty object is read as a finished pass with nothing found", () => {
    assertNothingFound(buttonFor({}));
});

test("a state with every field spelled out false and zero is the same as an empty one", () => {
    assert.deepEqual(buttonFor({ busy: false, errors: 0, failed: false }), buttonFor({}));
});

test("an unknown field is ignored rather than read as a state", () => {
    assert.deepEqual(buttonFor({ pending: true, count: 42, error: true }), buttonFor({}));
});

test("called with no state at all, it still answers a button", () => {
    assertNothingFound(buttonFor());
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
        // a button to paint and never an exception to throw.
        assert.doesNotThrow(() => buttonFor(state));
        assertNothingFound(buttonFor(state));
    });
}

for (const [label, errors] of [
    ["minus one", -1],
    ["a large negative count", -250],
    ["a numeric string", "3"],
    ["a numeric string above the cap", "250"],
    ["an empty string", ""],
    ["a word", "many"],
    ["a fraction", 2.5],
    ["a whole number written as a fraction", 3.0000001],
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
        assert.doesNotThrow(() => buttonFor({ busy: false, errors, failed: false }));
        assertNothingFound(buttonFor({ busy: false, errors, failed: false }));
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
        assert.equal(buttonFor({ busy: false, errors: 3, language }).label, expected);
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
        assert.equal(buttonFor({ busy: false, errors: 3, language }).label, "");
    });
}

test("a state that says nothing about the language leaves the label empty", () => {
    assert.equal(buttonFor({ busy: false, errors: 3, failed: false }).label, "");
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
        assert.equal(buttonFor(state).label, "FR");
    });
}

test("busy with no language known carries no label", () => {
    // Nothing is known yet, so the button says what it is doing through its
    // title rather than showing a caption that names nothing.
    assert.equal(buttonFor({ busy: true }).label, "");
    assert.equal(buttonFor({ busy: true, errors: 0, failed: false }).label, "");
});

test("the language is a label and never reaches the badge or the title", () => {
    // The badge counts mistakes and the title explains them, so a language
    // landing in either would overwrite what the reader is looking for.
    const button = buttonFor({ busy: false, errors: 3, language: "fr" });

    assert.equal(button.text, "3");
    assert.equal(button.title, "3 mistakes");
});

test("an unusable count does not survive as a title either", () => {
    // A tooltip reading "NaN mistakes" or "Infinity mistakes" would be worse
    // than no tooltip at all.
    for (const errors of [NaN, Infinity, -1, "3", null, 2.5]) {
        const button = buttonFor({ errors });

        assert.equal(button.title, NOTHING_FOUND);
        assert.equal(button.text, "");
    }
});

for (const [label, state] of EVERY_SHAPE) {
    test(`a button carries the six contract keys and nothing else (${label})`, () => {
        assert.deepEqual(Object.keys(buttonFor(state)).sort(), BUTTON_KEYS);
    });

    test(`the four strings are strings and the colours never vary (${label})`, () => {
        const button = buttonFor(state);

        // The icon goes straight to setIcon, where anything but a relative path
        // is refused by the schema, and the text to a badge, where a number is
        // not a caption.
        assert.equal(typeof button.icon, "string");
        assert.equal(typeof button.text, "string");
        assert.equal(typeof button.title, "string");
        assert.equal(typeof button.label, "string");
        assert.equal(button.background, BADGE_BACKGROUND);
        assert.equal(button.textColor, BADGE_TEXT);
    });

    test(`the badge is never asked for more room than it has (${label})`, () => {
        const button = buttonFor(state);

        assert.ok(button.text.length <= BADGE_WIDTH, JSON.stringify(button.text));
    });

    test(`the title always says something, whatever the button shows (${label})`, () => {
        // An empty badge and an empty label both fall back to the title, and an
        // icon says nothing in words, so the title is the one thing that can
        // never be blank.
        assert.notEqual(buttonFor(state).title, "");
    });
}

test("every icon a state can put on the button is a file the extension ships", () => {
    // Walked from what the module really answers and never from a list written
    // here, because a path that resolves to nothing is not a blank button: an
    // absent icon falls back to Thunderbird's generic puzzle piece, and nothing
    // on screen says which of the two is wrong.
    const states = [
        undefined, null, "busy", 3, [], {},
        { busy: true }, { failed: true }, { busy: true, failed: true },
        ...Array.from({ length: 120 }, (_, errors) => ({ errors })),
        { errors: 250 }, { errors: 4321 }, { errors: Number.MAX_SAFE_INTEGER },
    ];

    for (const state of states) {
        const { icon } = buttonFor(state);

        assert.ok(existsSync(join(srcDir, icon)), `${icon} (${JSON.stringify(state)})`);
    }
});

test("the two states that are no count have a file each, and neither is the logo", () => {
    // Two states sharing a file is one of them wearing the other's picture, and
    // the button would then say nothing about the check, which is its whole job.
    assert.deepEqual(Object.values(STATE_ICONS).sort(), [ALERT, BUSY]);
    assert.ok(!Object.values(STATE_ICONS).includes(LOGO));
});

test("a state icon is the shape test/icons.mjs draws for its mark", () => {
    // Which is what makes the committed file a golden one: the drawing has a
    // home of its own, and a file edited by hand fails here rather than drifting
    // away from the rest of the family.
    for (const [mark, file] of Object.entries(STATE_ICONS)) {
        assert.equal(readFileSync(join(srcDir, file), "utf8"), ringIcon(mark), file);
    }
});

test("the wait is the only icon that moves", () => {
    // An alert that breathed would read as a check still running, and the two
    // states would become one.
    for (const mark of Object.keys(STATE_ICONS)) {
        assert.equal(ringIcon(mark).includes("@keyframes"), mark === BUSY_MARK, mark);
    }
    assert.ok(!readFileSync(join(srcDir, LOGO), "utf8").includes("@keyframes"));
});

test("the logo is drawn in the colour the rest of the button is", () => {
    // It is hand written and outside the drawing, being a different thing, so
    // the day one of the two is repainted this is what says the other was not.
    assert.ok(readFileSync(join(srcDir, LOGO), "utf8").includes(RING_COLOR));
});

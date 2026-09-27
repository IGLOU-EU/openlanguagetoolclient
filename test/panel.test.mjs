/**
 * The contract of src/panel.js: where the panel lands next to the word it
 * explains.
 *
 * The panel itself is a shadow root inside a compose window, so none of it can
 * be built under Node. Its placement can, and it is the part that decides
 * whether the explanation is read or half off the screen. The realm the script
 * is loaded in holds no `document` so that the arithmetic stays arithmetic,
 * which leaves one thing the panel says that no call here can make it say:
 * which family a mistake belongs to. That one is read as text at the end of
 * this file, out of the very script Thunderbird loads.
 *
 * Two rules carry the rest. The panel hangs under the word unless it would fall
 * out of the window, in which case it goes over it, and a panel with room on
 * neither side is pinned to the top rather than pushed out of reach: a panel
 * nobody can see is the same as no panel, and the click that opened it has
 * already happened. And the numbers come from a `Range` and a client rectangle
 * by way of a click handler, so an argument that makes no sense yields the top
 * left corner instead of throwing under the user's cursor.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadPanel } from "./compose-helpers.mjs";

const { api: olcPanel, publishedGlobals } = loadPanel();
const { placement } = olcPanel;

/** A compose window of ordinary size. No rule depends on the two numbers. */
const VIEWPORT = { width: 800, height: 600 };

/** The panel once filled: wide enough for a sentence, a few lines tall. */
const PANEL = { width: 300, height: 150 };

/** The gap between the word and the panel, small enough to read as attached. */
const MARGIN = 8;

/** The box of one underlined word, put wherever a test needs it. */
const word = (left, top, width = 60, height = 20) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
});

/**
 * Reads one answer back into a host object.
 *
 * The API lives in the loader's vm realm, so an object it builds never matches
 * the prototype a strict deep equality compares.
 */
const spotOf = (spot) => ({ left: spot.left, top: spot.top });

/** Where the panel lands, the defaults standing in for whatever is left out. */
const where = (anchor, { panel = PANEL, viewport = VIEWPORT, margin = MARGIN } = {}) =>
    spotOf(placement(anchor, panel, viewport, margin));

/** The four arguments of a sound call, for a test to spoil exactly one of them. */
const SOUND = [word(100, 200), PANEL, VIEWPORT, MARGIN];

/** Where the panel goes when nothing can be worked out at all. */
const CORNER = { left: 0, top: 0 };

/** What no box of coordinates can be read out of. */
const NOT_A_BOX = [
    ["nothing at all", undefined],
    ["null", null],
    ["a number", 42],
    ["zero", 0],
    ["a string", "100,200"],
    ["true", true],
    ["false", false],
    ["an object with no field at all", {}],
    ["an array of numbers", [100, 200, 160, 220]],
];

/** What no coordinate can be read out of. */
const NOT_A_NUMBER = [
    ["nothing at all", undefined],
    ["null", null],
    ["a string of digits", "100"],
    ["a word", "left"],
    ["an empty string", ""],
    ["true", true],
    ["false", false],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["minus Infinity", -Infinity],
    ["an object", {}],
    ["an array holding the number", [100]],
    ["a Number object", new Number(100)],
];

/** Which argument of a call each box is, so a test can spoil it by name. */
const BOXES = [["the anchor", 0], ["the panel", 1], ["the viewport", 2]];

/** Every field a position is read out of, and the argument that carries it. */
const FIELDS = [
    ["anchor.left", 0, "left"],
    ["anchor.top", 0, "top"],
    ["anchor.bottom", 0, "bottom"],
    ["panel.width", 1, "width"],
    ["panel.height", 1, "height"],
    ["viewport.width", 2, "width"],
    ["viewport.height", 2, "height"],
];

/**
 * A sound call with one argument replaced.
 *
 * @param {number} index Which of the four to replace.
 * @param {*} value What to put there.
 */
function spoiled(index, value) {
    const args = [...SOUND];
    args[index] = value;
    return args;
}

/**
 * Every combination worth sweeping a property over.
 *
 * Wide on purpose: a panel wider and taller than the window it opens in, a
 * window smaller than the word's own coordinates, a gap larger than everything.
 * None of it is a shape a compose window really takes, and all of it is a shape
 * the arithmetic has to survive.
 */
const SOUND_CALLS = (() => {
    const calls = [];
    for (const anchor of [
        word(0, 0),
        word(100, 200),
        word(400, 290),
        word(740, 580),
        { left: 0, top: 0, right: 0, bottom: 0 },
    ]) {
        for (const panel of [
            { width: 300, height: 150 },
            { width: 1000, height: 900 },
            { width: 1, height: 1 },
        ]) {
            for (const viewport of [{ width: 800, height: 600 }, { width: 200, height: 120 }]) {
                for (const margin of [0, 8, 40, 5000]) {
                    calls.push([anchor, panel, viewport, margin]);
                }
            }
        }
    }
    return calls;
})();

/** Enough of a call to name it in a failed assertion. */
const said = ([anchor, panel, viewport, margin]) =>
    `word at ${anchor.left},${anchor.top} | panel ${panel.width}x${panel.height}`
    + ` | viewport ${viewport.width}x${viewport.height} | margin ${margin}`;

test("the API is published on globalThis, and nothing else is", () => {
    // Thunderbird gives every compose script of one extension the same global,
    // so a second name would collide with a sibling script and kill it at
    // instantiation, with no trace but an opaque exception.
    assert.deepEqual(publishedGlobals, ["olcPanel"]);
});

test("the panel offers placement, show, hide and isOpen, and nothing else", () => {
    assert.deepEqual(Object.keys(olcPanel).sort(), ["hide", "isOpen", "placement", "show"]);

    for (const name of ["placement", "show", "hide", "isOpen"]) {
        assert.equal(typeof olcPanel[name], "function", name);
    }
});

test("the panel hangs under the word, one margin below it", () => {
    // The word stays visible, which is the whole reason the panel is not drawn
    // over it: the user reads the explanation against the text it is about.
    const anchor = word(100, 200);

    assert.deepEqual(where(anchor), { left: 100, top: 228 });
});

test("the gap under the word is the margin, whatever the margin is", () => {
    // Every one of these leaves the panel room below, so none of them flips it.
    for (const margin of [0, 1, 4, 8, 20, 97]) {
        const anchor = word(100, 200);

        assert.equal(where(anchor, { margin }).top, anchor.bottom + margin, `margin ${margin}`);
    }
});

test("a margin of zero puts the panel against the word", () => {
    const anchor = word(100, 200);

    assert.deepEqual(where(anchor, { margin: 0 }), { left: 100, top: 220 });
    assert.equal(where(anchor, { margin: 0 }).top, anchor.bottom);
});

test("with no room below and room above, the panel flips over the word", () => {
    // 520 plus the gap plus 150 falls out of a 600 tall window, 500 less the gap
    // less 150 does not fall out of its top.
    const anchor = word(100, 500);
    const spot = where(anchor);

    assert.deepEqual(spot, { left: 100, top: 342 });
    // Read from the panel's bottom edge, which is what the margin separates from
    // the word once the panel is above it.
    assert.equal(spot.top + PANEL.height, anchor.top - MARGIN);
});

test("the tallest panel that still fits below stays below, and one pixel more flips", () => {
    // The bottom edge of the window is the boundary itself: a panel ending
    // exactly on it has not fallen out of the window, and one pixel taller has.
    // 400 is the word's bottom edge, so 408 is the panel's top and 192 is what
    // is left under it.
    const anchor = word(100, 380);

    assert.equal(VIEWPORT.height - (anchor.bottom + MARGIN), 192);
    assert.deepEqual(where(anchor, { panel: { width: 300, height: 192 } }), {
        left: 100,
        top: 408,
    });
    assert.deepEqual(where(anchor, { panel: { width: 300, height: 193 } }), {
        left: 100,
        top: 179,
    });
});

test("with room on neither side the panel is pinned to the top of the window", () => {
    // 300 plus the gap plus 400 falls out of the bottom, and 280 less the gap
    // less 400 falls out of the top, so the whole panel fits nowhere. Below wins
    // over above by the first rule alone, so what is left is the clamp.
    const anchor = word(100, 280);

    assert.deepEqual(where(anchor, { panel: { width: 300, height: 400 } }), { left: 100, top: 0 });
});

test("a panel taller than the whole window is pinned to the top too", () => {
    // Which cuts its own bottom off, and shows its beginning. The explanation is
    // read from the top, and nothing else can be shown at all.
    for (const anchor of [word(0, 0), word(100, 200), word(700, 580)]) {
        assert.deepEqual(
            where(anchor, { panel: { width: 100, height: 900 } }),
            { left: anchor.left, top: 0 },
            `word at ${anchor.left},${anchor.top}`,
        );
    }
});

test("a margin larger than the window leaves room on neither side", () => {
    // Below, the gap alone is past the bottom. Above, it is past the top. The
    // panel is pinned, and it is still on screen, which is the point of the clamp.
    const anchor = word(100, 200);

    assert.deepEqual(where(anchor, { margin: 1000 }), { left: 100, top: 0 });
    assert.deepEqual(where(anchor, { margin: VIEWPORT.height }), { left: 100, top: 0 });
});

test("a word against the top of the window still gets the panel under it", () => {
    assert.deepEqual(where(word(100, 0)), { left: 100, top: 28 });
});

test("a word against the bottom of the window gets the panel over it", () => {
    const anchor = word(100, VIEWPORT.height - 20);
    const spot = where(anchor);

    assert.deepEqual(spot, { left: 100, top: 422 });
    assert.equal(spot.top + PANEL.height, anchor.top - MARGIN);
});

test("a word against the left edge of the window leaves the panel on that edge", () => {
    assert.deepEqual(where(word(0, 200)), { left: 0, top: 228 });
});

test("a word against the right edge of the window pulls the panel fully back", () => {
    const anchor = word(VIEWPORT.width - 60, 200);

    assert.deepEqual(where(anchor), { left: 500, top: 228 });
});

test("the panel follows the word's left edge while it fits", () => {
    // 500 is the last one that fits: 500 plus 300 lands on the right edge of the
    // window, which is inside it.
    for (const left of [0, 1, 100, 250, 499, 500]) {
        assert.equal(where(word(left, 200)).left, left, `word at ${left}`);
    }
});

test("the panel is pulled back by exactly what it overflowed on the right", () => {
    for (const [left, width, expected] of [
        [501, 300, 500],
        [600, 300, 500],
        [799, 300, 500],
        [400, 500, 300],
        [790, 60, 740],
    ]) {
        const spot = where(word(left, 200), { panel: { width, height: 150 } });

        assert.equal(spot.left, expected, `word at ${left} with a panel ${width} wide`);
        // No more than the overflow: the panel's right edge lands on the
        // window's, so the word stays as close to the panel's left edge as the
        // room allows.
        assert.equal(spot.left + width, VIEWPORT.width);
    }
});

test("a panel wider than the window is clamped to the left edge", () => {
    // Pulling it back would put it off the screen on the other side, and what is
    // cut off then is the beginning of the explanation instead of its end.
    for (const left of [0, 100, 740, 799]) {
        assert.equal(
            where(word(left, 200), { panel: { width: 1000, height: 150 } }).left,
            0,
            `word at ${left}`,
        );
    }
});

test("the margin never moves the panel sideways", () => {
    // It is the gap between the word and the panel, the panel hangs under or
    // over the word, so the gap is vertical and nothing else.
    for (const margin of [0, 8, 200]) {
        assert.equal(where(word(100, 200), { margin }).left, 100, `margin ${margin}`);
        assert.equal(where(word(740, 200), { margin }).left, 500, `margin ${margin}`);
    }
});

test("an anchor of no size, which is what an empty range gives, still places the panel", () => {
    // A click can land on a range that collapsed, and the panel still has to
    // open somewhere rather than nowhere.
    const collapsed = { left: 300, top: 250, right: 300, bottom: 250 };

    assert.deepEqual(where({ left: 0, top: 0, right: 0, bottom: 0 }), { left: 0, top: 8 });
    assert.deepEqual(where(collapsed), { left: 300, top: 258 });
});

test("the fractional coordinates a client rectangle really carries are kept", () => {
    // getBoundingClientRect answers in fractions of a pixel. Rounding them would
    // move the panel off the word it points at, by a hair on one screen and by
    // more once the window is zoomed.
    const anchor = { left: 100.5, top: 200.25, right: 160.75, bottom: 219.5 };

    assert.deepEqual(where(anchor, { margin: 7.5 }), { left: 100.5, top: 227 });
});

test("placement changes nothing of what it was handed", () => {
    // The compose script keeps the rectangle it read to place the panel again on
    // a scroll, so an argument quietly edited here would move the panel the
    // second time for no reason.
    const anchor = word(100, 200);
    const panel = { width: 1000, height: 900 };
    const viewport = { width: 800, height: 600 };

    placement(anchor, panel, viewport, MARGIN);

    assert.deepEqual(anchor, { left: 100, top: 200, right: 160, bottom: 220 });
    assert.deepEqual(panel, { width: 1000, height: 900 });
    assert.deepEqual(viewport, { width: 800, height: 600 });
});

test("a call missing an argument places the panel in the corner", () => {
    // It runs inside a click handler, and a placement that threw there would
    // take the click with it: the user would be left with an underline that
    // answers nothing at all.
    for (let given = 0; given < SOUND.length; given += 1) {
        const args = SOUND.slice(0, given);

        assert.doesNotThrow(() => placement(...args), `${given} arguments`);
        assert.deepEqual(spotOf(placement(...args)), CORNER, `${given} arguments`);
    }
});

for (const [name, index] of BOXES) {
    test(`${name} being no box of numbers places the panel in the corner`, () => {
        for (const [label, value] of NOT_A_BOX) {
            const args = spoiled(index, value);

            assert.doesNotThrow(() => placement(...args), label);
            assert.deepEqual(spotOf(placement(...args)), CORNER, label);
        }
    });
}

for (const [name, index, field] of FIELDS) {
    test(`${name} being no number places the panel in the corner`, () => {
        for (const [label, value] of NOT_A_NUMBER) {
            const args = spoiled(index, { ...SOUND[index], [field]: value });

            assert.doesNotThrow(() => placement(...args), `${name} as ${label}`);
            assert.deepEqual(spotOf(placement(...args)), CORNER, `${name} as ${label}`);
        }
    });
}

test("nonsense on the anchor's right edge costs neither an exception nor the screen", () => {
    // The anchor is the word's box, so the contract names four edges, and the
    // placement reads three of them. Whether the fourth is checked all the same
    // is not something the contract settles, and an anchor comes from a client
    // rectangle, which carries nothing but numbers. So what is pinned here is
    // what holds either way: no throw under the click, and no position that puts
    // the panel where it cannot be read.
    for (const [label, value] of NOT_A_NUMBER) {
        const args = spoiled(0, { ...SOUND[0], right: value });

        assert.doesNotThrow(() => placement(...args), label);

        const spot = spotOf(placement(...args));

        assert.ok(Number.isFinite(spot.left) && spot.left >= 0, `left of ${label}`);
        assert.ok(Number.isFinite(spot.top) && spot.top >= 0, `top of ${label}`);
    }
});

test("a margin that is no number places the panel in the corner", () => {
    for (const [label, value] of NOT_A_NUMBER) {
        const args = spoiled(3, value);

        assert.doesNotThrow(() => placement(...args), label);
        assert.deepEqual(spotOf(placement(...args)), CORNER, label);
    }
});

test("the answer is two finite numbers, neither of them negative, and nothing else", () => {
    // What the caller writes into a style attribute. A NaN there places the panel
    // nowhere, a negative number places it off the screen on the side the user is
    // not looking at, and a third field would be a coordinate nobody reads.
    const everyCall = [
        ...SOUND_CALLS,
        ...NOT_A_BOX.flatMap(([, value]) => [
            spoiled(0, value),
            spoiled(1, value),
            spoiled(2, value),
        ]),
        ...NOT_A_NUMBER.map(([, value]) => spoiled(3, value)),
    ];

    for (const args of everyCall) {
        const spot = placement(...args);
        const shown = JSON.stringify(args.map((argument) => argument ?? null));

        assert.equal(typeof spot, "object", shown);
        assert.notEqual(spot, null, shown);
        assert.deepEqual(Object.keys(spot).sort(), ["left", "top"], shown);
        assert.ok(Number.isFinite(spot.left), `left of ${shown}`);
        assert.ok(Number.isFinite(spot.top), `top of ${shown}`);
        assert.ok(spot.left >= 0, `left of ${shown}`);
        assert.ok(spot.top >= 0, `top of ${shown}`);
    }
});

test("the panel is under the word, over it, or at the top, and nowhere else", () => {
    // Stated as a property over every shape, where the tests above pin the exact
    // numbers and the boundary: what this adds is that no other position is ever
    // invented, whatever the window and the panel are worth.
    for (const args of SOUND_CALLS) {
        const [anchor, panel, viewport, margin] = args;
        const spot = spotOf(placement(...args));

        assert.ok(
            [anchor.bottom + margin, anchor.top - margin - panel.height, 0].includes(spot.top),
            `top ${spot.top} of ${said(args)}`,
        );
        assert.ok(
            [anchor.left, viewport.width - panel.width, 0].includes(spot.left),
            `left ${spot.left} of ${said(args)}`,
        );
    }
});

test("wherever there is room under the word, that is where the panel goes", () => {
    // The first rule, over every shape. The comparison is repeated here on
    // purpose, and the boundary it turns on is pinned by a literal above, so a
    // condition off by one fails there rather than agreeing with itself here.
    for (const args of SOUND_CALLS) {
        const [anchor, panel, viewport, margin] = args;
        const below = anchor.bottom + margin;

        if (below + panel.height <= viewport.height) {
            assert.equal(spotOf(placement(...args)).top, below, said(args));
        }
    }
});

test("the word's left edge is kept wherever the panel fits on it", () => {
    for (const args of SOUND_CALLS) {
        const [anchor, panel, viewport] = args;

        if (anchor.left + panel.width <= viewport.width) {
            assert.equal(spotOf(placement(...args)).left, anchor.left, said(args));
        }
    }
});

// What the panel says about the family a mistake belongs to: a band of that
// family's colour, five pixels wide, down the edge of the card. It is built
// with a DOM this realm does not hold, so what carries it is read as text out
// of the script itself, the way test/underline.test.mjs reads src/compose.css.

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

const source = readFileSync(join(srcDir, "panel.js"), "utf8");

/** The panel's stylesheet, which lives in the script: a shadow root inherits none. */
const stylesheet = /const STYLE = `([\s\S]*?)`;/.exec(source)?.[1] ?? "";

/** Its rules, comments taken out: they say in prose what the rules do. */
const rules = [...stylesheet.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body }));

/** Everything declared for one selector, from each rule that carries it. */
const bodyFor = (selector) => rules
    .filter((rule) => rule.selector === selector)
    .map((rule) => rule.body)
    .join("");

/** The two corners the band ends at, named the way the card reasons. */
const START_CORNERS = ["border-start-start-radius", "border-end-start-radius"];

test("the stylesheet read here is the one the panel loads", () => {
    // Everything below is matched against this text, so an empty one would
    // prove the panel carries no dot by proving nothing at all.
    assert.notEqual(stylesheet.trim(), "");
    assert.ok(rules.some((rule) => rule.selector === ".card"), "no rule for the card");
});

test("the family's colour is a band five pixels wide down the edge of the card", () => {
    assert.match(bodyFor(".card"), /border-inline-start-width\s*:\s*5px/);
});

test("the edge the band is on is the one the text starts at, never the left one", () => {
    // A compose window written right to left lays the card out the other way
    // round, and a physical edge would leave the band where the text ends.
    assert.ok(!/border-left|borderLeft/.test(source), "a physical left edge");
});

test("the three sides the band is not on keep their hairline", () => {
    // One edge of the card is widened. The card is not replaced by that edge.
    assert.match(bodyFor(".card"), /border\s*:\s*1px solid ButtonBorder/);
});

for (const corner of START_CORNERS) {
    test(`${corner} is squared, so the band is not bitten off at that end`, () => {
        // The card's radius curves a band this wide away over its whole width,
        // and what is left of it at either end reads as chipped.
        assert.match(bodyFor(".card"), new RegExp(`${corner}\\s*:\\s*0`), corner);
    });
}

test("the card keeps its rounded corners on the side that carries no band", () => {
    assert.match(bodyFor(".card"), /border-radius\s*:\s*4px/);
});

test("the colour of the band comes from the match and from nowhere else", () => {
    // One panel explains one mistake, so the family is that match's own fact.
    // A colour in the stylesheet would paint every panel alike, whatever it is
    // opened on.
    assert.match(source, /\.style\.borderInlineStartColor\s*=\s*textOf\(match\?\.color\)/);
    assert.ok(!/border-inline-start-color/.test(bodyFor(".card")), "a colour in the stylesheet");
});

test("a match with no usable colour keeps the hairline's colour and not the text's", () => {
    // The colour is read through textOf, which answers the empty string for
    // anything that is not a text, and an empty string sets no declaration at
    // all. What the band falls back to is therefore whatever the stylesheet
    // leaves on that side, and nothing there may name a colour: the shorthand
    // form of the property carries currentColor, which is five pixels of
    // CanvasText standing for a family the panel cannot name.
    const body = bodyFor(".card");

    assert.match(body, /border\s*:\s*1px solid ButtonBorder/);
    assert.ok(!/border-inline-start\s*:/.test(body), "a shorthand on that side");
    assert.ok(!/border-inline-start-color/.test(body), "a colour of its own on that side");
});

test("nothing of the dot is left, neither the rule nor the element", () => {
    // The family is said once. A dot kept beside the band would say it twice,
    // and a rule left behind styles an element nothing builds any more.
    assert.equal(bodyFor(".dot"), "");
    assert.ok(!/"dot"/.test(source), "a class of that name is still built");
});

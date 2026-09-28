/**
 * The contract between src/background/swatch.js, src/settings.js and
 * src/compose/compose.css: every family of mistake and every thickness those
 * two declare has its own rule in the stylesheet, the stylesheet carries none
 * for a pair they never name, and the colour a family is underlined in is the
 * very colour its menu icon is painted with.
 *
 * The compose script names a highlight "olc-", the family the event page put on
 * the match and the stored level, so that name is the whole link between the
 * files. A pair with no rule at the other end underlines nothing: the mistakes
 * are found, filed and never shown, and no log anywhere says so. That silence is
 * the reason the link is held here from both ends.
 *
 * The colours are declared twice, in src/background/swatch.js for the icons and in the
 * stylesheet for the marks, because a stylesheet injected into the page being
 * written cannot read a module and this project has no build step to derive one
 * from the other. Holding them equal here is what stands in for that derivation:
 * two copies become two colours the day one of them is edited alone, and that is
 * caught here rather than on screen.
 *
 * The family a mistake the server named nothing usable for falls into is a copy
 * of the same kind, spelled in src/compose/compose.js because a compose script imports
 * nothing either, and held against the module at the end of this file. A
 * fallback that drifted names a highlight no rule reaches, so it fails into that
 * same silence.
 *
 * The stylesheet and the script are read as text, because Node has no CSS engine
 * and no DOM, and because the files read here are the very ones Thunderbird
 * loads.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { UNDERLINES } from "../src/settings.js";
import { SWATCHES, familyOf } from "../src/background/swatch.js";
import { srcDir } from "./helpers.mjs";

/** What compose.js puts before the family and the level to name the highlight. */
const PREFIX = "olc-";

/** The five families, in the order src/background/swatch.js declares them. */
const FAMILIES = Object.keys(SWATCHES);

/** The name one family at one level is registered under. */
const nameFor = (family, level) => `${PREFIX}${family}-${level}`;

/** Comments taken out: they name the rules in prose, and only the rules count. */
const stylesheet = readFileSync(join(srcDir, "compose/compose.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The stylesheet as selector and body pairs.
 *
 * Split by hand and not by a parser: this file holds a handful of flat rules,
 * with no nesting and no at-rule, and a dependency is refused here.
 */
const rules = [...stylesheet.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector, body }));

/** The highlight names one selector list reaches. */
const namesIn = (selector) =>
    [...selector.matchAll(/::highlight\(\s*([^\s()]+)\s*\)/g)].map(([, name]) => name);

/** Everything declared for one highlight name, from each rule that reaches it. */
const bodyFor = (name) => rules
    .filter((rule) => namesIn(rule.selector).includes(name))
    .map((rule) => rule.body)
    .join("");

/** The colours one body carries, in the case the comparison is made in. */
const colorsIn = (body) =>
    [...body.matchAll(/#[0-9a-f]+/gi)].map(([color]) => color.toLowerCase());

const declared = new Set(rules.flatMap((rule) => namesIn(rule.selector)));

for (const family of FAMILIES) {
    for (const level of UNDERLINES) {
        const name = nameFor(family, level);

        test(`a ${family} at ${level} has a highlight rule in compose.css`, () => {
            assert.ok(declared.has(name), `no ::highlight(${name}) rule`);
        });

        test(`a ${family} at ${level} is dotted and skips no descender`, () => {
            const body = bodyFor(name);
            // Dotted, decided against the real client: a wave grows into the
            // lines above and below as it thickens, and a plain line under a
            // word is what a hyperlink looks like.
            assert.match(body, /text-decoration:\s*underline\s+dotted/);
            // The engine breaks an underline wherever a descender crosses it,
            // which takes the mark away under the very letters being checked.
            assert.match(body, /text-decoration-skip-ink\s*:\s*none/);
        });
    }

    test(`a ${family} is underlined in the colour src/background/swatch.js declares`, () => {
        // Equal and not merely present: a colour close to the icon's is a
        // mistake shown in two colours, which is the drift this test exists for.
        for (const level of UNDERLINES) {
            assert.deepEqual(
                colorsIn(bodyFor(nameFor(family, level))),
                [SWATCHES[family].toLowerCase()],
            );
        }
    });
}

for (const level of UNDERLINES) {
    test(`the level ${level} sets a thickness of its own`, () => {
        // A level that sets none draws at whatever the engine picks, which is
        // the same line for all three and a setting that changes nothing.
        for (const family of FAMILIES) {
            assert.match(
                bodyFor(nameFor(family, level)),
                /text-decoration-thickness\s*:/,
            );
        }
    });
}

test("compose.css declares no highlight rule outside the families and the levels", () => {
    // The other way round: a rule kept for a family or a level nobody names any
    // more is dead weight nothing can ever select, and the name of a pair the
    // compose script will never register.
    const pairs = FAMILIES
        .flatMap((family) => UNDERLINES.map((level) => nameFor(family, level)));
    const ours = [...declared].filter((name) => name.startsWith(PREFIX));
    assert.deepEqual(ours.sort(), pairs.sort());
});

/** The family src/compose/compose.js paints a mistake the event page named nothing for. */
const fallback = /const FALLBACK_FAMILY = "([^"]*)";/
    .exec(readFileSync(join(srcDir, "compose/compose.js"), "utf8"))?.[1];

test("compose.js falls back to the family src/background/swatch.js falls back to", () => {
    // The two names are compared and not merely both present: a compose side
    // that fell back to a family of its own would ask for a highlight the
    // stylesheet has no rule for, and every mistake the server left unnamed
    // would go unmarked with nothing to say so.
    assert.notEqual(fallback, undefined, "no FALLBACK_FAMILY declared in src/compose/compose.js");
    assert.equal(fallback, familyOf("a kind the server never named"));
});

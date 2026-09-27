/**
 * The contract of src/menu.js: what the context menu offers for one match.
 *
 * A module of the event page side, with no Thunderbird API and no DOM, so the
 * whole menu is provable under Node where no menu exists. The event page is
 * left with the calls that create the items and the one that reads a click.
 *
 * Four rules carry the rest, and two of them come from what the platform
 * allows, established on the shipped build in
 * `Etudes/thunderbird-155-api-mailextension/compose-body-context-menu.md`.
 *
 * A right click on an underlined word is never silent, because a match with
 * nothing to propose still says what is objected to. Every item is top level and
 * none names a parent, because two or more top level items are collapsed by the
 * platform into one submenu named with the extension's own name, which is the
 * shape a secondary path takes now that the click on the word is how a
 * correction is applied. That grouping is also what lets the explanation keep
 * its colour, since a custom icon is honoured only for an item inside a submenu
 * and a lone top level item has its own replaced by the extension's. The colour
 * is said on that one line and on no other, and a replacement carries the icon
 * that draws nothing rather than none at all, for the reason `src/menu.js` gives
 * beside it. The explanation never takes a click, because there is nothing in
 * it to apply, and its title is shortened here, because the platform crops it at
 * a width no extension can read and takes the tail with no sign that anything is
 * missing. And an item's id is what comes back from the click, so an id that
 * does not name its own replacement would insert another one into the message.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_REPLACEMENTS, MESSAGE_LIMIT, menuItemsFor } from "../src/menu.js";
import { SWATCHES, blankIcon, choiceFor, swatchFor } from "../src/swatch.js";

/** The id of the item that explains the mistake and refuses the click. */
const MESSAGE_ID = "olc-message";

/** One character, so the shortening costs the text as little room as possible. */
const ELLIPSIS = "…";

/** The keys every item carries, sorted the way Object.keys gives them. */
const ITEM_KEYS = ["enabled", "icons", "id", "title"];

const MESSAGE = "Possible typo";

/** The kind of mistake of the capture the tests are built on. */
const ISSUE_TYPE = "misspelling";

/** The text the mistake covers, four characters as the offsets below say. */
const COVERED = "cafe";

/** U+2423 OPEN BOX, what src/swatch.js shows for a whitespace character. */
const OPEN_BOX = "␣";

/** U+2205 EMPTY SET, what it shows for a deletion covering nothing usable. */
const EMPTY_SET = "∅";

/**
 * A match as src/languagetool.js normalizes one, plus the covered text the
 * compose script adds to it.
 *
 * The offset and the length are kept, though the menu has no use for them:
 * what the menu is built from is a match as it really arrives, and a function
 * reading more than it needs is what these tests are here to catch. The covered
 * text is the one the menu does read, since a replacement that deletes has
 * nothing of its own to put on a line.
 */
const match = (message, replacements, issueType = ISSUE_TYPE, text = COVERED) => ({
    offset: 9,
    length: 4,
    message,
    replacements,
    ruleId: "MORFOLOGIK_RULE",
    categoryId: "TYPOS",
    issueType,
    text,
});

/**
 * A French explanation of exactly that many characters.
 *
 * Real ones are French prose, accents and typographic apostrophes included, and
 * a length counted in bytes is not the length that gets cropped.
 */
function messageOf(length) {
    const prose = "Un participe passé est attendu après l’auxiliaire avoir, pas un infinitif. ";
    return prose.repeat(Math.ceil(length / prose.length)).slice(0, length);
}

/** Twenty ways to say the same thing, more than any menu shows. */
const many = Array.from({ length: 20 }, (_, rank) => `option ${rank}`);

const idsOf = (items) => items.map((item) => item.id);
const titlesOf = (items) => items.map((item) => item.title);

/** The swatch the explanation of a mistake of that family carries. */
const iconOf = (family = ISSUE_TYPE) => ({ 16: swatchFor(SWATCHES[family]) });

/** What every other entry carries instead, which draws nothing and says nothing. */
const BLANK = { 16: blankIcon() };

/**
 * Every icon a swatch can be.
 *
 * A test says "one of the swatches" through this rather than by restating the
 * format src/swatch.js gives them. That format is that module's business, it has
 * already changed once, and a test that copies it turns its own change into a
 * false failure.
 */
const EVERY_SWATCH = Object.values(SWATCHES).map(swatchFor);

/**
 * The explanation, which says what is objected to and applies nothing.
 *
 * It is disabled because it is a caption and not a choice, and it is the one item
 * that carries the swatch: the platform does not dim an icon, so the colour is
 * read there even on a line drawn grey.
 */
const explanationOf = (title, family = ISSUE_TYPE) => ({
    id: MESSAGE_ID,
    title,
    enabled: false,
    icons: iconOf(family),
});

/**
 * One replacement, which says nothing of the kind of mistake it corrects.
 *
 * The title is what src/swatch.js shows for the replacement, which for an
 * ordinary one is the replacement itself and for a deletion is the covered text.
 */
const replacementOf = (rank, title) => ({
    id: `olc-${rank}`,
    title,
    enabled: true,
    icons: BLANK,
});

/** The ids of that many replacements, in the order the menu offers them. */
const replacementIds = (count) => Array.from({ length: count }, (_, rank) => `olc-${rank}`);

/** The ids of an explained match offering that many replacements. */
const expectedIds = (count) => [MESSAGE_ID, ...replacementIds(count)];

/**
 * Every shape menuItemsFor has to answer, with the limit it is given.
 *
 * The match crosses a message boundary before it gets here, so a shape nobody
 * meant to send is the ordinary case and not an exotic one.
 */
const EVERY_SHAPE = [
    ["a message and two replacements", match(MESSAGE, ["café", "cafés"]), undefined],
    ["a message and twenty replacements", match(MESSAGE, many), undefined],
    ["a message and twenty replacements, limit three", match(MESSAGE, many), 3],
    ["a message alone", match(MESSAGE, []), undefined],
    ["replacements alone", match("", ["café", "cafés"]), undefined],
    ["one replacement alone", match("", ["café"]), undefined],
    ["a message and a limit of zero", match(MESSAGE, ["café"]), 0],
    ["a limit of zero and no message", match("", ["café"]), 0],
    ["a message longer than the line", match(messageOf(200), ["café"]), undefined],
    ["a message of spaces", match("   ", ["café"]), undefined],
    ["a replacement that is no string", match(MESSAGE, [42, "café", null]), undefined],
    ["a replacement that deletes", match(MESSAGE, [""]), undefined],
    [
        "a replacement that deletes, covering nothing",
        match(MESSAGE, [""], ISSUE_TYPE, ""),
        undefined,
    ],
    ["a replacement of one space", match(MESSAGE, [" "]), undefined],
    ["a replacement padded with spaces", match(MESSAGE, [" café "]), undefined],
    ["a match with no covered text", { message: MESSAGE, replacements: ["", "café"] }, undefined],
    ["a message that is no string", { message: 42, replacements: ["café"] }, undefined],
    ["a grammar mistake", match(MESSAGE, ["mangé"], "grammar"), undefined],
    ["an issue type nobody declared", { message: MESSAGE, replacements: ["café"] }, undefined],
    ["an issue type that is no string", match(MESSAGE, ["café"], 42), undefined],
    ["nothing at all", match("", []), undefined],
    ["an empty object", {}, undefined],
    ["undefined", undefined, undefined],
    ["null", null, undefined],
    ["a number", 3, undefined],
    ["a string", MESSAGE, undefined],
    ["an array", ["café"], undefined],
    ["true", true, undefined],
];

test("MAX_REPLACEMENTS is how many replacements a menu offers", () => {
    // The only test that spells the number out, so a change of mind is decided
    // here and nowhere else. A menu is read at a glance, and past a handful of
    // suggestions the server is guessing anyway.
    assert.equal(MAX_REPLACEMENTS, 5);
});

test("a match with a message and replacements: the mistake, then what to put instead", () => {
    const items = menuItemsFor(match(MESSAGE, ["café", "cafés"]));

    assert.deepEqual(items, [
        explanationOf(MESSAGE),
        replacementOf(0, "café"),
        replacementOf(1, "cafés"),
    ]);
});

test("no item names a parent, which is what hands the grouping to the platform", () => {
    // Two or more top level items are collapsed into one submenu named with the
    // extension's own name, and that submenu is the shape wanted here. A parentId
    // would build a submenu of our own instead and keep a single item in the menu.
    const items = menuItemsFor(match(MESSAGE, ["café", "cafés"]));

    assert.equal(items.length, 3);
    for (const item of items) {
        assert.ok(!("parentId" in item), item.id);
        assert.equal(item.parentId, undefined, item.id);
    }
});

test("every item carries the same four keys and nothing besides", () => {
    // A menus.create call is checked against the schema, and an unknown property
    // is refused, so an item carries exactly what the platform reads.
    const items = menuItemsFor(match(MESSAGE, ["café", "cafés"]));

    for (const item of items) {
        assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS, item.id);
    }
});

test("the explanation refuses the click and every replacement takes one", () => {
    // The explanation is a caption: enabled it would look like a suggestion and
    // do nothing. A replacement is the one thing there is to apply.
    const [explanation, ...replacements] = menuItemsFor(match(MESSAGE, ["café", "cafés"]));

    assert.equal(explanation.id, MESSAGE_ID);
    assert.equal(explanation.enabled, false);
    assert.equal(replacements.length, 2);
    for (const item of replacements) {
        assert.equal(item.enabled, true, item.id);
    }
});

test("the explanation carries the swatch, and it is the only item that does", () => {
    // Inside the extension's submenu a custom icon is honoured on every item, and
    // the platform dims the text of a disabled item without touching its icon, so
    // the colour of the mistake is read on the very line that names it. One line
    // is where it is said: the same colour under it again says nothing more.
    const [explanation, ...replacements] = menuItemsFor(match(MESSAGE, ["café", "cafés"]));

    assert.deepEqual(explanation.icons, iconOf());
    assert.equal(replacements.length, 2);
    for (const item of replacements) {
        assert.deepEqual(item.icons, BLANK, item.id);
        assert.notEqual(item.icons[16], explanation.icons[16], item.id);
    }
});

test("the explanation's id names no replacement rank", () => {
    // A click comes back with an id and nothing else, and the rank read out of it
    // is what finds the replacement to write.
    assert.ok(!/^olc-\d+$/.test(MESSAGE_ID));

    const items = menuItemsFor(match(MESSAGE, many));

    assert.equal(items.filter((item) => item.id === MESSAGE_ID).length, 1);
    assert.equal(new Set(idsOf(items)).size, items.length);
});

test("a match with one replacement gives the explanation and that one item", () => {
    const items = menuItemsFor(match(MESSAGE, ["café"]));

    assert.deepEqual(items, [explanationOf(MESSAGE), replacementOf(0, "café")]);
});

test("the replacements keep the order the server sent them in", () => {
    // The server ranks them, the best one first, and a menu that reorders them
    // buries the answer the user was looking for.
    const ordered = ["first", "second", "third", "fourth"];

    const items = menuItemsFor(match(MESSAGE, ordered));

    assert.deepEqual(titlesOf(items), [MESSAGE, ...ordered]);
    assert.deepEqual(idsOf(items), expectedIds(4));
});

test("a match with twenty replacements is capped at MAX_REPLACEMENTS", () => {
    const items = menuItemsFor(match(MESSAGE, many));

    assert.equal(items.length, MAX_REPLACEMENTS + 1);
    assert.deepEqual(idsOf(items), expectedIds(MAX_REPLACEMENTS));
    assert.deepEqual(titlesOf(items), [MESSAGE, ...many.slice(0, MAX_REPLACEMENTS)]);
});

for (const limit of [1, 2, 3, 4]) {
    test(`a limit of ${limit} keeps that many replacements, the first ones`, () => {
        const items = menuItemsFor(match(MESSAGE, many), limit);

        assert.equal(items.length, limit + 1);
        assert.deepEqual(idsOf(items), expectedIds(limit));
        assert.deepEqual(titlesOf(items), [MESSAGE, ...many.slice(0, limit)]);
    });
}

test("the limit counts the replacements alone, the explanation is not one of them", () => {
    // It is the number of ways of correcting the mistake that a menu cannot carry,
    // and a cap that ate the explanation would hide a suggestion instead.
    const items = menuItemsFor(match(MESSAGE, many), MAX_REPLACEMENTS);

    assert.equal(items.length, MAX_REPLACEMENTS + 1);
    assert.equal(items.filter((item) => item.enabled).length, MAX_REPLACEMENTS);
});

test("a limit of zero gives the explanation alone", () => {
    // Still not silent: the menu says what is objected to even when it is told to
    // propose nothing.
    const items = menuItemsFor(match(MESSAGE, ["café", "cafés"]), 0);

    assert.deepEqual(items, [explanationOf(MESSAGE)]);
});

test("a limit of zero and no message gives an empty menu", () => {
    // Nothing is left to show: the replacements are capped away and there is no
    // explanation to fall back on.
    assert.deepEqual(menuItemsFor(match("", ["café", "cafés"]), 0), []);
});

test("a limit larger than the list gives every replacement", () => {
    const items = menuItemsFor(match(MESSAGE, ["café", "cafés", "cafetière"]), 10);

    assert.equal(items.length, 4);
    assert.deepEqual(idsOf(items), expectedIds(3));
    assert.deepEqual(titlesOf(items), [MESSAGE, "café", "cafés", "cafetière"]);
});

test("a limit that is exactly the length of the list gives every replacement", () => {
    const items = menuItemsFor(match(MESSAGE, ["café", "cafés", "cafetière"]), 3);

    assert.deepEqual(titlesOf(items), [MESSAGE, "café", "cafés", "cafetière"]);
});

for (const [label, limit] of [
    ["missing", undefined],
    ["null", null],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["minus Infinity", -Infinity],
    ["minus one", -1],
    ["a large negative limit", -20],
    ["a numeric string", "3"],
    ["a word", "three"],
    ["an empty string", ""],
    ["true", true],
    ["false", false],
    ["an object", {}],
    ["an empty array", []],
    ["an array holding a number", [3]],
]) {
    test(`a limit that is no usable count (${label}) falls back to MAX_REPLACEMENTS`, () => {
        const items = menuItemsFor(match(MESSAGE, many), limit);

        assert.equal(items.length, MAX_REPLACEMENTS + 1);
        assert.deepEqual(idsOf(items), expectedIds(MAX_REPLACEMENTS));
    });
}

test("a match whose message is empty gives the replacements alone", () => {
    // There is nothing to explain and no caption to invent, and the ids start at
    // the first rank all the same: a hole at the top would be an id the click can
    // name and the menu never showed.
    const items = menuItemsFor(match("", ["café", "cafés"]));

    assert.deepEqual(items, [replacementOf(0, "café"), replacementOf(1, "cafés")]);
    assert.deepEqual(idsOf(items), replacementIds(2));
});

test("a match whose message is missing gives the replacements alone", () => {
    const items = menuItemsFor({ offset: 9, length: 4, replacements: ["café"] });

    assert.deepEqual(items, [replacementOf(0, "café")]);
});

test("a message that is no string gives the replacements alone too", () => {
    // A menu item's title is a string, and a number is not a caption. The match
    // crosses a message boundary before it gets here, and nothing on the way
    // guarantees the field.
    for (const message of [42, [MESSAGE], {}, true, null]) {
        const items = menuItemsFor({ message, replacements: ["café"], issueType: ISSUE_TYPE });

        assert.deepEqual(items, [replacementOf(0, "café")], String(message));
    }
});

test("no message and one replacement give a menu of exactly one item", () => {
    // Which the platform then leaves at the menu's top level instead of grouping
    // it, and whose icon it replaces with the extension's own. The contract makes
    // no exception for it, so the item is the plain first replacement.
    const items = menuItemsFor(match("", ["café"]));

    assert.deepEqual(items, [replacementOf(0, "café")]);
});

test("a match with no replacement at all still says what is objected to", () => {
    // Otherwise a right click on an underlined word opens a menu with nothing of
    // the extension in it, and the underline looks like a bug.
    const expected = [explanationOf(MESSAGE)];

    assert.deepEqual(menuItemsFor(match(MESSAGE, [])), expected);
    assert.deepEqual(menuItemsFor({ offset: 9, length: 4, message: MESSAGE }), [
        explanationOf(MESSAGE, "other"),
    ]);
    assert.deepEqual(menuItemsFor(match(MESSAGE, null)), expected);
    assert.deepEqual(menuItemsFor(match(MESSAGE, [42, null, {}])), expected);
});

test("a match with neither a message nor a replacement gives an empty menu", () => {
    assert.deepEqual(menuItemsFor(match("", [])), []);
    assert.deepEqual(menuItemsFor(match("", [42])), []);
    assert.deepEqual(menuItemsFor({ offset: 9, length: 4 }), []);
    assert.deepEqual(menuItemsFor({}), []);
});

for (const [label, found] of [
    ["null", null],
    ["undefined", undefined],
    ["a number", 3],
    ["a string", MESSAGE],
    ["an array", ["café"]],
    ["an empty array", []],
    ["an empty object", {}],
    ["true", true],
]) {
    test(`a match that is ${label} gives an empty menu`, () => {
        // It arrives as a message from another context, and a menu that threw
        // would take the whole right click with it.
        assert.doesNotThrow(() => menuItemsFor(found));
        assert.deepEqual(menuItemsFor(found), []);
    });
}

test("menuItemsFor called with nothing at all gives an empty menu", () => {
    assert.deepEqual(menuItemsFor(), []);
});

test("a replacement that is no string is left out of the menu", () => {
    // Only a string can be inserted into the message being written.
    const mixed = ["café", 42, "cafés", null, undefined, {}, "cafetière"];

    const items = menuItemsFor(match(MESSAGE, mixed));

    assert.deepEqual(titlesOf(items), [MESSAGE, "café", "cafés", "cafetière"]);
});

test("the limit counts the replacements the menu offers, not the ones read", () => {
    // A cap of three that shows one entry would hide two replacements the user
    // could have used, for values that were never offerable in the first place.
    const items = menuItemsFor(match(MESSAGE, [42, null, "café", "cafés", "cafetière"]), 3);

    assert.deepEqual(titlesOf(items), [MESSAGE, "café", "cafés", "cafetière"]);
});

test("the ids of the replacements kept after a skip stay consecutive", () => {
    // A rank is the rank in the menu the user sees: the click comes back with
    // an id, and what it has to find is the replacement offered under it.
    const items = menuItemsFor(match(MESSAGE, [42, "café", null, "cafés"]));

    assert.deepEqual(idsOf(items), expectedIds(2));
    assert.deepEqual(titlesOf(items), [MESSAGE, "café", "cafés"]);
});

test("a skipped replacement takes no id at all", () => {
    // An id reserved for a value that was never offered would be an entry the
    // click can name and the menu cannot show.
    const items = menuItemsFor(match(MESSAGE, [null, undefined, 42, "café"]));

    assert.deepEqual(items, [explanationOf(MESSAGE), replacementOf(0, "café")]);
});

test("a skipped replacement takes no id when there is no explanation either", () => {
    // The first rank belongs to the first replacement the menu offers, and the
    // absence of the explanation changes nothing about that.
    const items = menuItemsFor(match("", [null, 42, "café", {}, "cafés"]));

    assert.deepEqual(items, [replacementOf(0, "café"), replacementOf(1, "cafés")]);
});

// What a replacement is titled with, which is no longer the replacement itself.
// A rule that deletes suggests the empty string and a rule that separates
// suggests a space, so put on a line as they come the first is an invisible entry
// and the second one the width of a space, both of them clickable. src/swatch.js
// says what to show for a replacement, and the menu asks it rather than deciding
// the same thing a second time. What it cannot use is the strikethrough that
// comes with the answer, since an extension cannot style a menu item.

test("a replacement that deletes is titled with the text it removes", () => {
    // Which says the mistake will disappear, and says it without a word in any
    // language. The covered text is this match's own, sliced out of what was
    // sent, so two mistakes do not show one another's.
    assert.deepEqual(menuItemsFor(match(MESSAGE, [""])), [
        explanationOf(MESSAGE),
        replacementOf(0, COVERED),
    ]);
    assert.deepEqual(menuItemsFor(match(MESSAGE, [""], ISSUE_TYPE, "manger")), [
        explanationOf(MESSAGE),
        replacementOf(0, "manger"),
    ]);
});

test("a replacement that deletes and covers nothing usable is still a line", () => {
    // A match that crossed the message boundary before the field existed carries
    // no covered text at all, and one that covers only spaces says nothing.
    for (const covered of ["", "   ", undefined, null, 42]) {
        const items = menuItemsFor({ ...match(MESSAGE, [""]), text: covered });

        assert.deepEqual(
            items,
            [explanationOf(MESSAGE), replacementOf(0, EMPTY_SET)],
            String(covered),
        );
    }

    const withoutCovered = match(MESSAGE, [""]);
    delete withoutCovered.text;

    assert.deepEqual(menuItemsFor(withoutCovered), [
        explanationOf(MESSAGE),
        replacementOf(0, EMPTY_SET),
    ]);
});

test("a replacement of one space is titled with one open box", () => {
    const items = menuItemsFor(match(MESSAGE, [" "]));

    assert.deepEqual(items, [explanationOf(MESSAGE), replacementOf(0, OPEN_BOX)]);
});

test("a replacement of two spaces is titled with two open boxes", () => {
    // Two spaces and one space are two different suggestions, and the line is all
    // the user has to tell them apart.
    const items = menuItemsFor(match(MESSAGE, ["  ", " "]));

    assert.deepEqual(titlesOf(items), [MESSAGE, `${OPEN_BOX}${OPEN_BOX}`, OPEN_BOX]);
});

test("a replacement's spaces at the ends are marked, its inner ones are not", () => {
    // A suggestion of several words has ordinary spaces in it, and boxing those
    // would make the line unreadable.
    const items = menuItemsFor(match(MESSAGE, [" un café ", "un café"]));

    assert.deepEqual(titlesOf(items), [MESSAGE, `${OPEN_BOX}un café${OPEN_BOX}`, "un café"]);
});

test("an ordinary replacement is titled with the replacement itself", () => {
    // What was there before the deletions were dealt with, and what has to stay
    // there: the line of an ordinary suggestion is the very string it writes.
    const items = menuItemsFor(match(MESSAGE, ["café", "cafés", "cafetière"]));

    assert.deepEqual(titlesOf(items), [MESSAGE, "café", "cafés", "cafetière"]);
});

test("every replacement is titled with what src/swatch.js shows for it", () => {
    // The rule lives in one place, so a menu spelling its own would drift from
    // the panel, which offers the same replacements as buttons.
    const values = ["café", "", " ", "  ", " café ", "un café", "\tcafé "];

    const items = menuItemsFor(match(MESSAGE, values), values.length);

    assert.deepEqual(
        titlesOf(items).slice(1),
        values.map((value) => choiceFor(value, COVERED).text),
    );
});

test("a deleting replacement keeps its rank and the ids stay consecutive", () => {
    // Only a value that cannot be written at all is skipped. A deletion is a
    // suggestion like any other and takes the next id in the menu, since the id
    // is what comes back from the click.
    const items = menuItemsFor(match(MESSAGE, [42, "", "café", " ", null, "cafés"]));

    assert.deepEqual(idsOf(items), expectedIds(4));
    assert.deepEqual(titlesOf(items), [MESSAGE, COVERED, "café", OPEN_BOX, "cafés"]);
});

test("the cap counts a deletion like any other replacement", () => {
    const items = menuItemsFor(match(MESSAGE, ["", " ", "café", "cafés"]), 3);

    assert.deepEqual(idsOf(items), expectedIds(3));
    assert.deepEqual(titlesOf(items), [MESSAGE, COVERED, OPEN_BOX, "café"]);
});

test("a match whose only replacement deletes is not a menu of one blank line", () => {
    // The entry used to be there and empty, so the menu looked as though it had
    // lost a line.
    const items = menuItemsFor(match("", [""]));

    assert.deepEqual(items, [replacementOf(0, COVERED)]);
});

test("a replacement carries no strikethrough flag, a menu item cannot be styled", () => {
    // src/swatch.js says a deletion is struck through and that is the panel's
    // business. An unknown property on a menus.create call is refused by the
    // schema, so what the menu cannot use it must not carry.
    for (const value of ["", " ", "café"]) {
        const [, item] = menuItemsFor(match(MESSAGE, [value]));

        assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS);
        assert.ok(!("struck" in item));
    }
});

test("menuItemsFor leaves the caller's match alone", () => {
    // It is the match the compose script holds and the cache keeps, and the next
    // right click on the same word reads it again.
    const found = match(MESSAGE, ["café", 42, "cafés"]);
    const before = structuredClone(found);

    menuItemsFor(found, 1);

    assert.deepEqual(found, before);
    assert.deepEqual(found.replacements, ["café", 42, "cafés"]);
});

test("a message of exactly the limit is sent whole", () => {
    const message = messageOf(MESSAGE_LIMIT);
    assert.equal(message.length, MESSAGE_LIMIT);

    const [explanation] = menuItemsFor(match(message, ["café"]));

    assert.equal(explanation.title, message);
    assert.ok(!explanation.title.includes(ELLIPSIS));
});

test("a message one character past the limit is shortened to the limit", () => {
    // The ellipsis is counted in the eighty, so the line the platform receives
    // is never longer than the one that was measured to fit.
    const message = messageOf(MESSAGE_LIMIT + 1);
    assert.equal(message.length, MESSAGE_LIMIT + 1);

    const [explanation] = menuItemsFor(match(message, ["café"]));

    assert.equal(explanation.title.length, MESSAGE_LIMIT);
    assert.equal(explanation.title, message.slice(0, MESSAGE_LIMIT - 1) + ELLIPSIS);
});

for (const length of [MESSAGE_LIMIT + 1, MESSAGE_LIMIT + 2, 158, 500]) {
    test(`a message of ${length} characters is shortened, ellipsis included`, () => {
        const message = messageOf(length);

        const [explanation] = menuItemsFor(match(message, ["café"]));

        assert.equal(explanation.title.length, MESSAGE_LIMIT);
        assert.ok(explanation.title.endsWith(ELLIPSIS));
        assert.equal(explanation.title.slice(0, -1), message.slice(0, MESSAGE_LIMIT - 1));
    });
}

for (const length of [1, 40, MESSAGE_LIMIT - 1, MESSAGE_LIMIT]) {
    test(`a message of ${length} characters is left exactly as it is`, () => {
        const message = messageOf(length);

        const [explanation] = menuItemsFor(match(message, ["café"]));

        assert.equal(explanation.title, message);
    });
}

test("the shortening spends one character on the ellipsis, not three dots", () => {
    // Three dots would cost three of the characters the line has, and the
    // platform's own crop draws one glyph anyway.
    const [explanation] = menuItemsFor(match(messageOf(200), ["café"]));

    assert.ok(explanation.title.endsWith(ELLIPSIS));
    assert.ok(!explanation.title.endsWith("..."));
    assert.equal(explanation.title.length, MESSAGE_LIMIT);
});

test("the shortening leaves one ellipsis in the title, not one per cut", () => {
    const [explanation] = menuItemsFor(match(messageOf(500), ["café"]));

    assert.equal([...explanation.title].filter((glyph) => glyph === ELLIPSIS).length, 1);
});

test("shortening a message changes nothing about the replacements", () => {
    // A replacement is inserted into the message being written, so cutting one
    // would write a truncated word into the mail.
    const long = "x".repeat(200);

    const items = menuItemsFor(match(messageOf(200), [long]));

    assert.equal(items[1].title, long);
    assert.equal(items[1].title.length, 200);
});

for (const [issueType, family] of [
    ["misspelling", "misspelling"],
    ["grammar", "grammar"],
    ["typographical", "typographical"],
    ["whitespace", "typographical"],
    ["style", "style"],
    ["register", "style"],
    ["uncategorized", "other"],
    ["", "other"],
]) {
    test(`a ${issueType || "nameless"} mistake is explained in the ${family} colour`, () => {
        const [explanation, ...replacements] = menuItemsFor(
            match(MESSAGE, ["café", "cafés"], issueType),
        );

        assert.deepEqual(explanation.icons, iconOf(family));
        assert.equal(replacements.length, 2);
        for (const item of replacements) {
            assert.deepEqual(item.icons, BLANK, item.id);
        }
    });
}

test("two matches of different kinds are explained in different colours", () => {
    // The colour is the only sign of what kind of mistake it is, so two kinds
    // that came out the same would say nothing at all.
    const typo = menuItemsFor(match(MESSAGE, ["café"], "misspelling"));
    const grammar = menuItemsFor(match(MESSAGE, ["mangé"], "grammar"));

    assert.equal(typo[0].icons[16], swatchFor(SWATCHES.misspelling));
    assert.equal(grammar[0].icons[16], swatchFor(SWATCHES.grammar));
    assert.notEqual(typo[0].icons[16], grammar[0].icons[16]);
    // And their replacements say nothing about the kind, in either menu.
    assert.equal(typo[1].icons[16], grammar[1].icons[16]);
});

test("a mistake is coloured once however many replacements it has", () => {
    // They are the same mistake read five ways, not five mistakes, and the line
    // that says what is objected to is where that is said.
    const items = menuItemsFor(match(MESSAGE, many, "typographical"));

    assert.equal(items.length, MAX_REPLACEMENTS + 1);
    assert.equal(items.filter((item) => EVERY_SWATCH.includes(item.icons[16])).length, 1);
    assert.equal(items[0].icons[16], swatchFor(SWATCHES.typographical));
});

for (const [label, issueType] of [
    ["an issueType that is no string", 42],
    ["an issueType that is null", null],
    ["an issueType that is an object", {}],
    ["an issueType that is an array", ["misspelling"]],
    ["an issueType nobody has a colour for", "mistranslation"],
]) {
    test(`${label} is explained in the other family's colour`, () => {
        const items = menuItemsFor(match(MESSAGE, ["café"], issueType));

        assert.equal(items[0].icons[16], swatchFor(SWATCHES.other));
        assert.equal(items[1].icons[16], blankIcon());
    });
}

test("a match with no issueType field at all is explained in the other colour", () => {
    // Every match normalized by src/languagetool.js has the field, but the match
    // crosses a message boundary and an older cached one predates it.
    const found = { offset: 9, length: 4, message: MESSAGE, replacements: ["café"] };
    assert.ok(!("issueType" in found));

    const items = menuItemsFor(found);

    assert.equal(items[0].icons[16], swatchFor(SWATCHES.other));
    assert.equal(items[1].icons[16], blankIcon());
});

test("an icon is the only thing the icons object carries, under the key 16", () => {
    // The platform asks for sixteen device pixels and picks the key equal to the
    // request, so a dictionary under another key would be a fallback at best.
    const [explanation, ...replacements] = menuItemsFor(match(MESSAGE, ["café", "cafés"]));

    for (const item of [explanation, ...replacements]) {
        assert.deepEqual(Object.keys(item.icons), ["16"], item.id);
    }
    assert.ok(EVERY_SWATCH.includes(explanation.icons[16]));
    for (const item of replacements) {
        assert.equal(item.icons[16], blankIcon(), item.id);
    }
});

for (const [label, found, limit] of EVERY_SHAPE) {
    test(`a menu is one explanation at most and its replacements (${label})`, () => {
        // The match arrives from another context, so an unusable one is an empty
        // menu to build and never an exception to throw.
        assert.doesNotThrow(() => menuItemsFor(found, limit));
        const items = menuItemsFor(found, limit);

        assert.ok(Array.isArray(items));
        assert.equal(new Set(idsOf(items)).size, items.length);
        if (items.length === 0) {
            return;
        }

        const explained = items[0].id === MESSAGE_ID;
        assert.equal(items.filter((item) => item.id === MESSAGE_ID).length, explained ? 1 : 0);

        for (const item of items) {
            assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS, item.id);
            // A parentId would build a submenu of our own, where the shape wanted
            // is the one the platform builds when it finds two top level items.
            assert.ok(!("parentId" in item), item.id);
            assert.equal(typeof item.id, "string");
            assert.equal(typeof item.title, "string");
            assert.notEqual(item.title, "", item.id);
            // Every entry carries an icon, coloured or not, because one with none
            // is padded into the indicator column instead of taking it.
            assert.deepEqual(Object.keys(item.icons), ["16"], item.id);
        }

        if (explained) {
            assert.equal(items[0].enabled, false);
            assert.ok(items[0].title.length <= MESSAGE_LIMIT, `title of ${items[0].title.length}`);
            assert.ok(EVERY_SWATCH.includes(items[0].icons[16]), items[0].icons[16]);
        }

        const replacements = explained ? items.slice(1) : items;
        assert.deepEqual(idsOf(replacements), replacementIds(replacements.length));
        assert.ok(
            replacements.length <= (limit ?? MAX_REPLACEMENTS),
            `${replacements.length} kept`,
        );
        for (const item of replacements) {
            assert.equal(item.enabled, true, item.id);
            // The colour belongs to the line that explains the mistake, so a
            // replacement carries the icon that draws nothing.
            assert.equal(item.icons[16], blankIcon(), item.id);
            // An entry is a line the user has to be able to see and read: a
            // replacement that deletes or that writes a space has no caption of
            // its own, and an empty one would be an invisible clickable line.
            assert.notEqual(item.title.trim(), "", item.id);
        }
    });

    test(`a replacement's id names its own value and no other (${label})`, () => {
        // The event page reads the rank out of the id that comes back from the
        // click and writes the replacement standing at that rank, so a rank that
        // slipped would insert a suggestion the user never chose.
        const offered = (Array.isArray(found?.replacements) ? found.replacements : [])
            .map((value) => choiceFor(value, found?.text))
            .filter((choice) => choice !== null);

        for (const item of menuItemsFor(found, limit)) {
            if (item.id === MESSAGE_ID) {
                continue;
            }
            const rank = Number(item.id.slice("olc-".length));
            assert.ok(Number.isInteger(rank), item.id);
            assert.equal(item.title, offered[rank].text, item.id);
        }
    });
}

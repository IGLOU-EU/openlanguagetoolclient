/**
 * The contract of `actionMenuItems` in src/menu.js: what the compose window's
 * toolbar button offers when its menu opens.
 *
 * A module of the event page side, with no Thunderbird API and no DOM, so the
 * whole menu is provable under Node where no button exists. The event page is
 * left with the `browser.menus` calls that create the items and the sending of
 * what a click orders.
 *
 * Seven rules carry the rest. The actions the writer needs are reachable
 * whatever the server answered about the languages, because a menu that loses
 * "Settings" when the server is unreachable leaves no way to fix the address.
 * An item's id is what comes back from the click, so two items sharing one id
 * would apply the wrong order to the message. The checked radio is what the
 * writer reads to know which language is in force, so it names the language
 * actually used and never a second one. Every entry of the menu itself carries
 * an icon, because the platform keeps the indicator column for the entries that
 * have one and pads the others into it, which staggers the labels of a menu
 * mixing the two. On the two checkboxes that icon draws nothing and is never
 * seen, the platform marking those entries itself. The two lines explaining
 * those checkboxes are the one place that padding is wanted, since it is what
 * binds each line to the entry above it, so they carry no icon at all and a
 * reader is not to give them one. Every icon an entry names resolves to a file
 * packaged with the extension, because the compose window draws the engine's
 * torn page for one that does not. And every entry the menu offers orders
 * something of the compose window, unless it is one of those that cannot: an
 * entry mapped to nothing is a click that does nothing, with no error and no log
 * to say so.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MESSAGE_LIMIT, actionMenuItems, menuItemsFor, orderFor } from "../src/menu.js";
import { SWATCHES, blankIcon } from "../src/swatch.js";

const LANGUAGE_ID = "olc-language";
const AUTO_ID = "olc-language-auto";
const REDETECT_ID = "olc-redetect";
const RECHECK_ID = "olc-recheck";
const OPTIONS_ID = "olc-options";
const PICKY_RULE_ID = "olc-picky-rule";
const PICKY_ID = "olc-picky";
const PICKY_NOTE_ID = "olc-picky-note";
const CHECKING_RULE_ID = "olc-checking-rule";
const CHECKING_ID = "olc-checking";
const CHECKING_NOTE_ID = "olc-checking-note";

/** The language submenu and the one radio it always holds, which come first. */
const HEAD_IDS = [LANGUAGE_ID, AUTO_ID];

/** Everything under the language list, in the order the menu shows it. */
const TAIL_IDS = [
    REDETECT_ID,
    RECHECK_ID,
    OPTIONS_ID,
    PICKY_RULE_ID,
    PICKY_ID,
    PICKY_NOTE_ID,
    CHECKING_RULE_ID,
    CHECKING_ID,
    CHECKING_NOTE_ID,
];

/**
 * The items that do not depend on the language list, in the order the menu
 * shows them. Nothing the server answers, and no state the compose window is
 * in, may take one of these away.
 */
const FIXED_IDS = [...HEAD_IDS, ...TAIL_IDS];

/** The two rules, and the group each one opens. */
const GROUPS = [
    [PICKY_RULE_ID, PICKY_ID, PICKY_NOTE_ID],
    [CHECKING_RULE_ID, CHECKING_ID, CHECKING_NOTE_ID],
];

/** The two rules, which is what every group opens with. */
const RULE_IDS = GROUPS.map(([rule]) => rule);

/** The two lines that explain a mode, which is what every group ends with. */
const NOTE_IDS = GROUPS.map(([, , note]) => note);

/**
 * The entries carrying a glyph of their own, and the glyph each one carries.
 *
 * Spelled out here and nowhere else, so a glyph is swapped in one place. The two
 * checkboxes are not of the set: the platform hides the icon of an entry of that
 * type and draws its own mark in the column instead.
 */
const GLYPHS = [
    [LANGUAGE_ID, "glyph-globe.svg"],
    [REDETECT_ID, "glyph-magnifier.svg"],
    [RECHECK_ID, "glyph-arrows.svg"],
    [OPTIONS_ID, "glyph-gear.svg"],
];

/**
 * The entries no order is ever sent for.
 *
 * The parent of the language list takes no click at all, it opens its submenu,
 * and the settings entry is answered by the event page itself, which opens the
 * options page instead of telling the compose window anything. A rule takes no
 * click either, and a line explaining a mode refuses one.
 */
const NO_ORDER = [LANGUAGE_ID, OPTIONS_ID, ...RULE_IDS, ...NOTE_IDS];

/**
 * The order types the compose script answers (`src/compose.js`, the
 * `browser.runtime.onMessage` listener), and no fifth.
 */
const ORDER_TYPES = ["language", "picky", "checking", "recheck"];

/** The keys an item carries, sorted the way Object.keys gives them back. */
const ITEM_KEYS = ["checked", "icons", "id", "title", "type"];

/**
 * The keys an item hanging under a parent carries, sorted the same way.
 *
 * No icon: the language entries are radios among radios, so the platform gives
 * them all one treatment and they line up with each other on their own.
 */
const CHILD_KEYS = ["checked", "id", "parentId", "title", "type"];

/** The keys a rule carries: no title, which is the one type not to need one. */
const RULE_KEYS = ["id", "type"];

/** The keys a line explaining a mode carries, no icon among them. */
const NOTE_KEYS = ["checked", "enabled", "id", "title", "type"];

/** The four types a `browser.menus` item may be, and no fifth. */
const TYPES = ["normal", "radio", "checkbox", "separator"];

/** Where the packaged icons sit, which is the directory the extension is built from. */
const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/**
 * A language list shaped as `languages()` returns one.
 *
 * Written here and not captured: a fixture is a real server answer, and this
 * file has no business inventing one under test/fixtures. Two entries share the
 * code "fr" on purpose, because the menu asks for a language by its longCode.
 */
const SERVER_LIST = [
    { name: "English (US)", code: "en", longCode: "en-US" },
    { name: "French", code: "fr", longCode: "fr" },
    { name: "French (Canada)", code: "fr", longCode: "fr-CA" },
    { name: "German (Germany)", code: "de", longCode: "de-DE" },
];

/** The id an entry of the list is offered under. */
const idFor = (longCode) => `olc-language-${longCode}`;

/** The whole menu for the languages the server offered, the ids in order. */
const idsFor = (...longCodes) => [...HEAD_IDS, ...longCodes.map(idFor), ...TAIL_IDS];

/** The whole menu built from SERVER_LIST, the ids in order. */
const SERVER_LIST_IDS = idsFor(...SERVER_LIST.map((entry) => entry.longCode));

/**
 * One match, as `src/languagetool.js` normalizes one plus the covered text the
 * compose script adds.
 *
 * The entries it yields are `test/menu.test.mjs`'s business. It is built here
 * only to walk the icons the body's own menu names, since those are files too.
 */
const MATCH = { message: "Possible typo", replacements: ["café"], text: "cafe" };

/** The families a mistake is filed under, which is one swatch each. */
const FAMILIES = Object.keys(SWATCHES);

/** One issue type per family, and one the server never named for the fallback. */
const ISSUE_TYPES = [...FAMILIES, "uncategorized"];

/** A state as the event page builds one, with the fields under test overridden. */
const stateOf = (overrides = {}) => ({
    languages: SERVER_LIST,
    language: null,
    picky: false,
    checking: true,
    ...overrides,
});

const idsOf = (items) => items.map((item) => item.id);
const titlesOf = (items) => items.map((item) => item.title);
const itemOf = (items, id) => items.find((item) => item.id === id);
const radiosOf = (items) => items.filter((item) => item.type === "radio");
const checkedIdsOf = (items) =>
    items.filter((item) => item.checked === true).map((item) => item.id);

/**
 * Every shape actionMenuItems has to answer.
 *
 * The state is assembled from settings, from a server answer and from what the
 * compose script reported, so a field nobody meant to send is the ordinary case
 * here and not an exotic one.
 */
const EVERY_SHAPE = [
    ["a full state", stateOf({ language: "fr", picky: true })],
    ["automatic detection", stateOf({ language: null, checking: false })],
    ["a forced language the list does not offer", stateOf({ language: "es-ES" })],
    ["an empty list", stateOf({ languages: [] })],
    ["a list that is no array", stateOf({ languages: "fr" })],
    ["a list of unusable entries", stateOf({ languages: [null, 42, {}, { name: "Polish" }] })],
    [
        "a longCode offered twice",
        stateOf({
            languages: [
                { name: "French", code: "fr", longCode: "fr" },
                { name: "Français", code: "fr", longCode: "fr" },
            ],
        }),
    ],
    ["flags that are no booleans", stateOf({ picky: "yes", checking: 1 })],
    ["an empty object", {}],
    ["undefined", undefined],
    ["null", null],
    ["a number", 3],
    ["a string", "fr"],
    ["an array", [{ name: "French", code: "fr", longCode: "fr" }]],
];

/**
 * Every click the button's menu can report, and the order it stands for.
 *
 * The id is the whole of what a click says about the entry that was picked, and
 * `checked` the state the platform has just put it in, so an order read from
 * anything else would be read from a guess.
 */
const EVERY_CLICK = [
    ["automatic detection", { menuItemId: AUTO_ID }, { type: "language", language: null }],
    [
        "a language of the list",
        { menuItemId: idFor("fr-CA") },
        { type: "language", language: "fr-CA" },
    ],
    [
        "detecting the language again",
        { menuItemId: REDETECT_ID },
        { type: "language", language: null },
    ],
    ["the whole message again", { menuItemId: RECHECK_ID }, { type: "recheck" }],
    ["picky turned on", { menuItemId: PICKY_ID, checked: true }, { type: "picky", picky: true }],
    [
        "picky turned off",
        { menuItemId: PICKY_ID, checked: false },
        { type: "picky", picky: false },
    ],
    ["picky with no state reported", { menuItemId: PICKY_ID }, { type: "picky", picky: false }],
    [
        "checking turned on",
        { menuItemId: CHECKING_ID, checked: true },
        { type: "checking", checking: true },
    ],
    [
        "checking turned off",
        { menuItemId: CHECKING_ID, checked: false },
        { type: "checking", checking: false },
    ],
];

test("the captions are the ones the menu shows", () => {
    // The only test that spells them out, so a rewording is decided here and
    // nowhere else.
    const items = actionMenuItems(stateOf());

    assert.equal(itemOf(items, LANGUAGE_ID).title, "Language");
    assert.equal(itemOf(items, AUTO_ID).title, "Detect automatically");
    assert.equal(itemOf(items, REDETECT_ID).title, "Detect the language again");
    assert.equal(itemOf(items, RECHECK_ID).title, "Check the whole message again");
    assert.equal(itemOf(items, PICKY_ID).title, "Picky mode");
    assert.equal(itemOf(items, PICKY_NOTE_ID).title, "Also reports style and typography");
    assert.equal(itemOf(items, CHECKING_ID).title, "Check this message");
    assert.equal(
        itemOf(items, CHECKING_NOTE_ID).title,
        "Whether this message is checked at all, and off it is left alone",
    );
    assert.equal(itemOf(items, OPTIONS_ID).title, "Settings");
});

test("a line explaining a mode says what the mode is for, and fits the label", () => {
    // The platform crops a label at a width no extension can read, so a line
    // longer than that loses its end with nothing to say it was there. The limit
    // is the one src/menu.js shortens an explanation to, because it is the same
    // crop on the same kind of entry.
    const items = actionMenuItems(stateOf());

    for (const id of NOTE_IDS) {
        const { title } = itemOf(items, id);

        assert.notEqual(title, "");
        assert.ok(title.length <= MESSAGE_LIMIT, `${id} is ${title.length} characters`);
    }
});

test("a real looking list: the language parent and its radios, then the actions", () => {
    const items = actionMenuItems({
        languages: SERVER_LIST,
        language: null,
        picky: false,
        checking: true,
    });

    assert.deepEqual(items, [
        {
            id: LANGUAGE_ID,
            title: "Language",
            type: "normal",
            checked: false,
            icons: { 16: "glyph-globe.svg" },
        },
        {
            id: AUTO_ID,
            parentId: LANGUAGE_ID,
            title: "Detect automatically",
            type: "radio",
            checked: true,
        },
        {
            id: "olc-language-en-US",
            parentId: LANGUAGE_ID,
            title: "English (US)",
            type: "radio",
            checked: false,
        },
        {
            id: "olc-language-fr",
            parentId: LANGUAGE_ID,
            title: "French",
            type: "radio",
            checked: false,
        },
        {
            id: "olc-language-fr-CA",
            parentId: LANGUAGE_ID,
            title: "French (Canada)",
            type: "radio",
            checked: false,
        },
        {
            id: "olc-language-de-DE",
            parentId: LANGUAGE_ID,
            title: "German (Germany)",
            type: "radio",
            checked: false,
        },
        {
            id: REDETECT_ID,
            title: "Detect the language again",
            type: "normal",
            checked: false,
            icons: { 16: "glyph-magnifier.svg" },
        },
        {
            id: RECHECK_ID,
            title: "Check the whole message again",
            type: "normal",
            checked: false,
            icons: { 16: "glyph-arrows.svg" },
        },
        {
            id: OPTIONS_ID,
            title: "Settings",
            type: "normal",
            checked: false,
            icons: { 16: "glyph-gear.svg" },
        },
        {
            id: PICKY_RULE_ID,
            type: "separator",
        },
        {
            id: PICKY_ID,
            title: "Picky mode",
            type: "checkbox",
            checked: false,
            icons: { 16: blankIcon() },
        },
        {
            id: PICKY_NOTE_ID,
            title: "Also reports style and typography",
            type: "normal",
            checked: false,
            enabled: false,
        },
        {
            id: CHECKING_RULE_ID,
            type: "separator",
        },
        {
            id: CHECKING_ID,
            title: "Check this message",
            type: "checkbox",
            checked: true,
            icons: { 16: blankIcon() },
        },
        {
            id: CHECKING_NOTE_ID,
            title: "Whether this message is checked at all, and off it is left alone",
            type: "normal",
            checked: false,
            enabled: false,
        },
    ]);
});

test("the language choice comes first and the two modes last", () => {
    // The menu is read top to bottom while writing, so the order is part of the
    // contract and not an accident of the loop that builds it.
    assert.deepEqual(idsOf(actionMenuItems(stateOf())), SERVER_LIST_IDS);
});

test("each mode is a rule, then the mode, then the line explaining it", () => {
    // The rule opens the group and never closes it: put after the line, it would
    // leave the menu ending on a rule with nothing under it, and the line would
    // sit against the entry it explains with no edge of its own above.
    const ids = idsOf(actionMenuItems(stateOf()));

    for (const group of GROUPS) {
        const at = ids.indexOf(group[0]);

        assert.notEqual(at, -1, group[0]);
        assert.deepEqual(ids.slice(at, at + group.length), group);
    }
    assert.equal(ids.at(-1), CHECKING_NOTE_ID);
});

test("a rule is a separator of its own, and the two are never the same entry", () => {
    // Two entries cannot share an id, and the event page takes the entries it
    // created down by id, so a rule left out of that list would survive the
    // rebuild and the menu would grow a line at every opening.
    const items = actionMenuItems(stateOf());

    for (const id of RULE_IDS) {
        assert.equal(itemOf(items, id).type, "separator", id);
        assert.deepEqual(Object.keys(itemOf(items, id)).sort(), RULE_KEYS, id);
    }
    assert.equal(new Set(RULE_IDS).size, RULE_IDS.length);
});

test("a line explaining a mode refuses the click and carries no icon at all", () => {
    // The missing icon is what the platform indents the entry for, and that
    // indent is the whole of what binds the line to the mode above it. Giving it
    // one would line it up with the modes and leave it reading as a third.
    const items = actionMenuItems(stateOf({ picky: true }));

    for (const id of NOTE_IDS) {
        const note = itemOf(items, id);

        assert.equal(note.type, "normal", id);
        assert.equal(note.enabled, false, id);
        assert.equal("icons" in note, false, id);
        assert.deepEqual(Object.keys(note).sort(), NOTE_KEYS, id);
    }
});

test("the language entries keep the order the server sent them in", () => {
    // The server sorts its list, and a menu that reorders it sends the reader
    // hunting for the language they were looking for.
    const unsorted = [
        { name: "Ukrainian", code: "uk", longCode: "uk" },
        { name: "Arabic", code: "ar", longCode: "ar" },
        { name: "Dutch", code: "nl", longCode: "nl" },
    ];

    const items = actionMenuItems({ languages: unsorted, language: null });

    assert.deepEqual(titlesOf(radiosOf(items)), [
        "Detect automatically",
        "Ukrainian",
        "Arabic",
        "Dutch",
    ]);
});

test("the parent of the language choice is a plain item nothing is checked on", () => {
    const parent = itemOf(actionMenuItems(stateOf({ language: "fr" })), LANGUAGE_ID);

    assert.equal(parent.type, "normal");
    assert.equal(parent.checked, false);
    assert.deepEqual(Object.keys(parent).sort(), ITEM_KEYS);
});

test("the settings entry is a plain item nothing is checked on", () => {
    const options = itemOf(actionMenuItems(stateOf({ picky: true })), OPTIONS_ID);

    assert.equal(options.type, "normal");
    assert.equal(options.checked, false);
    assert.deepEqual(Object.keys(options).sort(), ITEM_KEYS);
});

test("the two passes asked for by hand sit between the languages and the settings", () => {
    // They act on this message, like the two checkboxes further down, and one of
    // them undoes what the submenu above it imposed.
    const items = actionMenuItems(stateOf());

    assert.deepEqual(idsOf(items).slice(-TAIL_IDS.length), TAIL_IDS);
});

test("the two passes asked for by hand are plain items nothing is checked on", () => {
    // Each one does a thing once and holds no state, so a mark on either would
    // read as a mode left turned on.
    const items = actionMenuItems(stateOf({ picky: true, checking: false }));

    for (const id of [REDETECT_ID, RECHECK_ID]) {
        assert.equal(itemOf(items, id).type, "normal", id);
        assert.equal(itemOf(items, id).checked, false, id);
        assert.deepEqual(Object.keys(itemOf(items, id)).sort(), ITEM_KEYS, id);
    }
});

test("with no language forced, automatic detection is the one checked radio", () => {
    const items = actionMenuItems(stateOf({ language: null }));

    assert.deepEqual(checkedIdsOf(radiosOf(items)), [AUTO_ID]);
});

test("a forced language is the one checked radio, and automatic detection is not", () => {
    const items = actionMenuItems(stateOf({ language: "fr-CA" }));

    assert.deepEqual(checkedIdsOf(radiosOf(items)), [idFor("fr-CA")]);
    assert.equal(itemOf(items, AUTO_ID).checked, false);
});

test("a language is matched on its longCode, not on its code", () => {
    // Two entries of this list carry the code "fr", and forcing "fr" asks for
    // the one whose longCode is "fr", never for its Canadian variant.
    const items = actionMenuItems(stateOf({ language: "fr" }));

    assert.deepEqual(checkedIdsOf(radiosOf(items)), [idFor("fr")]);
});

test("a code that is nobody's longCode checks nothing", () => {
    // "en" is the code of the American English entry and the longCode of no
    // entry at all, so it names no language the menu can offer.
    const items = actionMenuItems(stateOf({ language: "en" }));

    assert.deepEqual(checkedIdsOf(radiosOf(items)), []);
});

test("a forced language the server no longer offers leaves every radio unchecked", () => {
    // The language was forced from a list the server has since changed, and a
    // menu that hid the entries would leave no way back to detection.
    const items = actionMenuItems(stateOf({ language: "es-ES" }));

    assert.deepEqual(idsOf(items), SERVER_LIST_IDS);
    assert.deepEqual(checkedIdsOf(radiosOf(items)), []);
});

for (const [label, language] of [
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["a number", 42],
    ["true", true],
    ["an object", {}],
    ["an array", ["fr"]],
]) {
    test(`a language that forces nothing (${label}) leaves automatic detection checked`, () => {
        // Nothing checked at all would say no language is in force, when the
        // message is being checked with the detected one.
        const items = actionMenuItems(stateOf({ language }));

        assert.deepEqual(checkedIdsOf(radiosOf(items)), [AUTO_ID]);
    });
}

test("a state that says nothing about the language is read as detection", () => {
    const items = actionMenuItems({ languages: SERVER_LIST, picky: false, checking: true });

    assert.deepEqual(checkedIdsOf(radiosOf(items)), [AUTO_ID]);
});

for (const picky of [false, true]) {
    for (const checking of [false, true]) {
        test(`picky ${picky} and checking ${checking} each land on their own checkbox`, () => {
            const items = actionMenuItems(stateOf({ picky, checking }));

            assert.equal(itemOf(items, PICKY_ID).type, "checkbox");
            assert.equal(itemOf(items, PICKY_ID).checked, picky);
            assert.equal(itemOf(items, CHECKING_ID).type, "checkbox");
            assert.equal(itemOf(items, CHECKING_ID).checked, checking);
        });
    }
}

test("a state that says nothing about picky and checking shows both unchecked", () => {
    const items = actionMenuItems({ languages: SERVER_LIST, language: null });

    assert.equal(itemOf(items, PICKY_ID).checked, false);
    assert.equal(itemOf(items, CHECKING_ID).checked, false);
});

test("the two checkboxes are independent of each other", () => {
    // One toggles what the server is asked for, the other whether it is asked at
    // all, and reading one for the other would surprise whoever clicked.
    assert.equal(itemOf(actionMenuItems(stateOf({ picky: true })), CHECKING_ID).checked, true);
    assert.equal(
        itemOf(actionMenuItems(stateOf({ checking: false, picky: true })), PICKY_ID).checked,
        true,
    );
});

test("each entry that can show a glyph carries its own, and no two are alike", () => {
    // The glyph is what the entry is read by at a glance, so two entries sharing
    // one would say they do the same thing.
    const items = actionMenuItems(stateOf({ picky: true }));

    for (const [id, glyph] of GLYPHS) {
        assert.equal(itemOf(items, id).icons[16], glyph, id);
    }
    assert.equal(new Set(GLYPHS.map(([, glyph]) => glyph)).size, GLYPHS.length);
});

test("the two modes carry the blank icon, which is all a checkbox can carry", () => {
    // They take the indicator column without drawing in it, because an entry that
    // leaves it empty is padded into it instead, and the labels of the menu then
    // stop starting at one place. Nothing could be shown there anyway: the
    // platform hides a checkbox's icon and draws its own mark in that column.
    const items = actionMenuItems(stateOf({ picky: true }));

    for (const id of [PICKY_ID, CHECKING_ID]) {
        assert.equal(itemOf(items, id).icons[16], blankIcon(), id);
    }
});

test("every icon either menu names is a file packaged with the extension", () => {
    // A path that resolves to nothing is the engine's torn page in the menu, for
    // every entry of it, and nothing anywhere says so. Both menus are walked as
    // they are actually built, because a list written out here would not be the
    // one the extension ships.
    const menus = [
        actionMenuItems(stateOf({ picky: true })),
        ...ISSUE_TYPES.map((issueType) => menuItemsFor({ ...MATCH, issueType })),
    ];

    const named = new Set();
    for (const item of menus.flat()) {
        for (const path of Object.values(item.icons ?? {})) {
            named.add(path);
            assert.ok(existsSync(join(srcDir, path)), `no packaged file named ${path}`);
        }
    }
    // What was walked, so a menu that stopped naming its icons cannot pass here
    // by naming none at all.
    for (const [, glyph] of GLYPHS) {
        assert.ok(named.has(glyph), glyph);
    }
    assert.ok(named.has(blankIcon()));
    assert.equal(named.size, GLYPHS.length + 1 + FAMILIES.length);
});

test("an entry that carries an icon is still the checkbox a click is read from", () => {
    // The click handler reads `info.checked` to know what was asked for, so the
    // icon is what an entry shows and never what it is.
    const items = actionMenuItems(stateOf({ picky: true, checking: false }));

    for (const [id, checked] of [
        [PICKY_ID, true],
        [CHECKING_ID, false],
    ]) {
        assert.equal(itemOf(items, id).type, "checkbox", id);
        assert.equal(itemOf(items, id).checked, checked, id);
    }
});

test("the language entries inside the submenu carry no icon of their own", () => {
    // They are radios among radios, so the platform gives them one treatment and
    // they already line up with each other.
    const items = actionMenuItems(stateOf({ language: "fr" }));

    assert.ok(radiosOf(items).length > 1);
    for (const item of radiosOf(items)) {
        assert.equal("icons" in item, false, item.id);
        assert.deepEqual(Object.keys(item).sort(), CHILD_KEYS, item.id);
    }
});

test("the same state twice gives the same menu, icons included", () => {
    // The event page persists the properties of every item it creates, so a menu
    // that varied between two openings would rewrite the store for nothing.
    assert.deepEqual(
        actionMenuItems(stateOf({ picky: true, checking: false })),
        actionMenuItems(stateOf({ picky: true, checking: false })),
    );
});

test("an empty language list still offers detection and every action", () => {
    // The server was reached and answered nothing usable, or was never reached
    // at all, and the settings must stay one click away.
    const items = actionMenuItems({ languages: [], language: null, picky: false, checking: true });

    assert.deepEqual(idsOf(items), FIXED_IDS);
    assert.deepEqual(checkedIdsOf(radiosOf(items)), [AUTO_ID]);
});

for (const [label, languages] of [
    ["missing", undefined],
    ["null", null],
    ["a number", 3],
    ["a string", "fr"],
    ["an object", {}],
    ["a lone entry sent unwrapped", { name: "French", code: "fr", longCode: "fr" }],
    ["true", true],
]) {
    test(`a language list that is no list (${label}) reads as an empty one`, () => {
        const items = actionMenuItems(stateOf({ languages }));

        assert.deepEqual(idsOf(items), FIXED_IDS);
    });
}

test("an entry the menu could neither name nor ask for is left out", () => {
    // A title is a caption and an id is what comes back from the click, so an
    // entry missing either is an item that cannot work.
    const items = actionMenuItems({
        languages: [
            { name: "French", code: "fr", longCode: "fr" },
            { name: 42, code: "de", longCode: "de-DE" },
            { code: "es", longCode: "es-ES" },
            { name: "Italian", code: "it", longCode: 42 },
            { name: "Dutch", code: "nl" },
            { name: ["Polish"], code: "pl", longCode: "pl-PL" },
            { name: "Greek", code: "el", longCode: {} },
            null,
            undefined,
            7,
            "Ukrainian",
            [],
            { name: "English (US)", code: "en", longCode: "en-US" },
        ],
        language: null,
    });

    assert.deepEqual(idsOf(items), idsFor("fr", "en-US"));
});

test("a skipped entry takes no id with it", () => {
    // The id names the language asked for, so it cannot be a rank in a list
    // whose unusable entries have been dropped.
    const items = actionMenuItems({
        languages: [null, { name: "French", code: "fr", longCode: "fr" }],
        language: "fr",
    });

    assert.deepEqual(idsOf(radiosOf(items)), [AUTO_ID, idFor("fr")]);
    assert.equal(itemOf(items, idFor("fr")).checked, true);
});

test("an entry with no code is still offered: the menu asks by longCode", () => {
    // Only the name and the longCode are read, because only those two reach the
    // item, and dropping an entry over a field nothing uses would hide a
    // language the server offers.
    const items = actionMenuItems({
        languages: [{ name: "French", longCode: "fr" }],
        language: "fr",
    });

    assert.deepEqual(idsOf(items), idsFor("fr"));
    assert.equal(itemOf(items, idFor("fr")).title, "French");
    assert.equal(itemOf(items, idFor("fr")).checked, true);
});

test("a longCode offered twice is kept once, the first of the two", () => {
    // Two items cannot share an id, and the click would then be ambiguous.
    const items = actionMenuItems({
        languages: [
            { name: "French", code: "fr", longCode: "fr" },
            { name: "French (Canada)", code: "fr", longCode: "fr-CA" },
            { name: "Français", code: "fr", longCode: "fr" },
        ],
        language: null,
    });

    assert.deepEqual(idsOf(items), idsFor("fr", "fr-CA"));
    assert.equal(itemOf(items, idFor("fr")).title, "French");
});

test("a longCode offered twice is still checkable", () => {
    const items = actionMenuItems({
        languages: [
            { name: "French", code: "fr", longCode: "fr" },
            { name: "Français", code: "fr", longCode: "fr" },
        ],
        language: "fr",
    });

    assert.deepEqual(checkedIdsOf(radiosOf(items)), [idFor("fr")]);
});

test("actionMenuItems called with nothing at all still offers the fixed items", () => {
    assert.deepEqual(idsOf(actionMenuItems()), FIXED_IDS);
});

test("actionMenuItems leaves the caller's state alone", () => {
    // The state is read again at the next opening of the menu, and the language
    // list is the one the options page and the check share.
    const given = {
        languages: structuredClone(SERVER_LIST),
        language: "fr",
        picky: true,
        checking: true,
    };
    const before = structuredClone(given);

    actionMenuItems(given);

    assert.deepEqual(given, before);
});

for (const [label, state] of EVERY_SHAPE) {
    test(`a menu is an array of usable items and nothing else (${label})`, () => {
        // The state is assembled from several sources, so an unusable one is a
        // menu to build and never an exception to throw.
        assert.doesNotThrow(() => actionMenuItems(state));
        const items = actionMenuItems(state);

        assert.ok(Array.isArray(items));
        for (const item of items) {
            assert.equal(typeof item.id, "string");
            assert.notEqual(item.id, "");
            assert.ok(TYPES.includes(item.type), String(item.type));
            // A rule has neither of the two, and it is the one type the schema
            // asks no title of.
            if (item.type === "separator") {
                assert.deepEqual(Object.keys(item).sort(), RULE_KEYS, item.id);
                continue;
            }
            assert.equal(typeof item.title, "string");
            assert.notEqual(item.title, "");
            assert.equal(typeof item.checked, "boolean");
        }
    });

    test(`every entry the menu can be clicked on carries one sixteen pixel icon (${label})`, () => {
        // An entry with no icon is padded into the indicator column instead of
        // taking it, and the labels then start at as many places as there are
        // kinds of entry. The language entries are the submenu's business, a rule
        // has nothing to line up, and on the two lines explaining a mode that
        // padding is the point.
        for (const item of actionMenuItems(state)) {
            if (item.type === "radio" || item.type === "separator") {
                continue;
            }
            if (NOTE_IDS.includes(item.id)) {
                assert.equal("icons" in item, false, item.id);
                continue;
            }
            assert.deepEqual(Object.keys(item.icons), ["16"], item.id);
            assert.equal(typeof item.icons[16], "string", item.id);
            assert.notEqual(item.icons[16], "", item.id);
        }
    });

    test(`the ids are distinct across the whole menu (${label})`, () => {
        const items = actionMenuItems(state);

        assert.equal(new Set(idsOf(items)).size, items.length);
    });

    test(`only the language entries hang under the language item (${label})`, () => {
        // A parentId on anything else buries an action in a submenu, and a
        // missing one on a language entry puts the whole list at top level.
        const items = actionMenuItems(state);

        for (const item of items) {
            if (item.type === "radio") {
                assert.equal(item.parentId, LANGUAGE_ID);
                assert.deepEqual(Object.keys(item).sort(), CHILD_KEYS);
            } else if (item.type === "separator") {
                assert.deepEqual(Object.keys(item).sort(), RULE_KEYS, item.id);
            } else if (NOTE_IDS.includes(item.id)) {
                assert.deepEqual(Object.keys(item).sort(), NOTE_KEYS, item.id);
            } else {
                assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS, item.id);
            }
        }
    });

    test(`the items that owe nothing to the server are all there, in order (${label})`, () => {
        const items = actionMenuItems(state);

        assert.ok(items.length >= FIXED_IDS.length);
        assert.deepEqual(idsOf(items).filter((id) => FIXED_IDS.includes(id)), FIXED_IDS);
    });

    test(`the types of the fixed items never vary (${label})`, () => {
        const items = actionMenuItems(state);

        assert.equal(itemOf(items, LANGUAGE_ID).type, "normal");
        assert.equal(itemOf(items, AUTO_ID).type, "radio");
        assert.equal(itemOf(items, REDETECT_ID).type, "normal");
        assert.equal(itemOf(items, RECHECK_ID).type, "normal");
        assert.equal(itemOf(items, OPTIONS_ID).type, "normal");
        assert.equal(itemOf(items, PICKY_RULE_ID).type, "separator");
        assert.equal(itemOf(items, PICKY_ID).type, "checkbox");
        assert.equal(itemOf(items, PICKY_NOTE_ID).type, "normal");
        assert.equal(itemOf(items, CHECKING_RULE_ID).type, "separator");
        assert.equal(itemOf(items, CHECKING_ID).type, "checkbox");
        assert.equal(itemOf(items, CHECKING_NOTE_ID).type, "normal");
    });

    test(`no more than one language is ever checked at once (${label})`, () => {
        // A radio group is a single choice, and two checked entries would say
        // the message is being checked in two languages.
        assert.ok(checkedIdsOf(radiosOf(actionMenuItems(state))).length <= 1);
    });

    test(`a plain item is never checked (${label})`, () => {
        // Nothing carries a state on it, so a checkmark there means nothing.
        for (const item of actionMenuItems(state)) {
            if (item.type === "normal") {
                assert.equal(item.checked, false);
            }
        }
    });
}

for (const [label, info, order] of EVERY_CLICK) {
    test(`a click on ${label} orders the compose window exactly that`, () => {
        assert.deepEqual(orderFor(info), order);
    });
}

test("detecting the language again orders what the detection radio already orders", () => {
    // The same order on purpose: the compose side already drops the language it
    // was given and checks the message over, so there is nothing else to ask of
    // it and no second way of asking to keep working.
    assert.deepEqual(orderFor({ menuItemId: REDETECT_ID }), orderFor({ menuItemId: AUTO_ID }));
});

for (const [label, menuItemId] of [
    ["the parent of the language list", LANGUAGE_ID],
    ["the settings entry", OPTIONS_ID],
    ["the rule above a mode", PICKY_RULE_ID],
    ["the rule above the other mode", CHECKING_RULE_ID],
    ["the line explaining a mode", PICKY_NOTE_ID],
    ["the line explaining the other mode", CHECKING_NOTE_ID],
    ["a replacement in the body's own menu", "olc-0"],
    ["the explanation of a mistake", "olc-message"],
    ["an id from nowhere", "olc-nothing"],
]) {
    test(`a click on ${label} orders the compose window nothing`, () => {
        // Every click on either menu reaches this, so an id it does not know is
        // the ordinary case and never a reason to send something.
        assert.equal(orderFor({ menuItemId }), null);
    });
}

test("every entry the menu offers is wired to an order the compose window answers", () => {
    // An entry mapped to nothing is a click that does nothing, with no error and
    // no log to say so, which is why the mapping is kept beside the ids it reads.
    // The exceptions are named above and they are the entries that take no click
    // at all: one of them answering an order would be a line a reader can press.
    for (const item of actionMenuItems(stateOf())) {
        const order = orderFor({ menuItemId: item.id, checked: item.checked });

        if (NO_ORDER.includes(item.id)) {
            assert.equal(order, null, item.id);
            continue;
        }
        assert.notEqual(order, null, item.id);
        assert.ok(ORDER_TYPES.includes(order.type), `${item.id} orders ${order.type}`);
    }
});

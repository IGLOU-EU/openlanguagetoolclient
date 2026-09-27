/**
 * The contract of `actionMenuItems` in src/menu.js: what the compose window's
 * toolbar button offers when its menu opens.
 *
 * A module of the event page side, with no Thunderbird API and no DOM, so the
 * whole menu is provable under Node where no button exists. The event page is
 * left with the `browser.menus` calls that create the items and the one that
 * reads a click.
 *
 * Three rules carry the rest. The actions the writer needs are reachable
 * whatever the server answered about the languages, because a menu that loses
 * "Settings" when the server is unreachable leaves no way to fix the address.
 * An item's id is what comes back from the click, so two items sharing one id
 * would apply the wrong order to the message. And the checked radio is what the
 * writer reads to know which language is in force, so it names the language
 * actually used and never a second one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { actionMenuItems } from "../src/menu.js";

const LANGUAGE_ID = "olc-language";
const AUTO_ID = "olc-language-auto";
const PICKY_ID = "olc-picky";
const CHECKING_ID = "olc-checking";
const OPTIONS_ID = "olc-options";

/**
 * The items that do not depend on the language list, in the order the menu
 * shows them. Nothing the server answers, and no state the compose window is
 * in, may take one of these away.
 */
const FIXED_IDS = [LANGUAGE_ID, AUTO_ID, PICKY_ID, CHECKING_ID, OPTIONS_ID];

/** The keys an item carries, sorted the way Object.keys gives them back. */
const ITEM_KEYS = ["checked", "id", "title", "type"];

/** The keys an item hanging under a parent carries, sorted the same way. */
const CHILD_KEYS = ["checked", "id", "parentId", "title", "type"];

/** The three types a `browser.menus` item may be, and no fourth. */
const TYPES = ["normal", "radio", "checkbox"];

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

/** The whole menu built from SERVER_LIST, the ids in order. */
const SERVER_LIST_IDS = [
    LANGUAGE_ID,
    AUTO_ID,
    ...SERVER_LIST.map((entry) => idFor(entry.longCode)),
    PICKY_ID,
    CHECKING_ID,
    OPTIONS_ID,
];

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

test("the captions are the ones the menu shows", () => {
    // The only test that spells them out, so a rewording is decided here and
    // nowhere else.
    const items = actionMenuItems(stateOf());

    assert.equal(itemOf(items, LANGUAGE_ID).title, "Language");
    assert.equal(itemOf(items, AUTO_ID).title, "Detect automatically");
    assert.equal(itemOf(items, PICKY_ID).title, "Picky mode");
    assert.equal(itemOf(items, CHECKING_ID).title, "Check this message");
    assert.equal(itemOf(items, OPTIONS_ID).title, "Settings");
});

test("a real looking list: the language parent and its radios, then the three actions", () => {
    const items = actionMenuItems({
        languages: SERVER_LIST,
        language: null,
        picky: false,
        checking: true,
    });

    assert.deepEqual(items, [
        { id: LANGUAGE_ID, title: "Language", type: "normal", checked: false },
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
        { id: PICKY_ID, title: "Picky mode", type: "checkbox", checked: false },
        { id: CHECKING_ID, title: "Check this message", type: "checkbox", checked: true },
        { id: OPTIONS_ID, title: "Settings", type: "normal", checked: false },
    ]);
});

test("the language choice comes first and the settings last", () => {
    // The menu is read top to bottom while writing, so the order is part of the
    // contract and not an accident of the loop that builds it.
    assert.deepEqual(idsOf(actionMenuItems(stateOf())), SERVER_LIST_IDS);
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

test("an empty language list still offers detection and the three actions", () => {
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

    assert.deepEqual(idsOf(items), [
        LANGUAGE_ID,
        AUTO_ID,
        idFor("fr"),
        idFor("en-US"),
        PICKY_ID,
        CHECKING_ID,
        OPTIONS_ID,
    ]);
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

    assert.deepEqual(idsOf(items), [
        LANGUAGE_ID,
        AUTO_ID,
        idFor("fr"),
        PICKY_ID,
        CHECKING_ID,
        OPTIONS_ID,
    ]);
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

    assert.deepEqual(idsOf(items), [
        LANGUAGE_ID,
        AUTO_ID,
        idFor("fr"),
        idFor("fr-CA"),
        PICKY_ID,
        CHECKING_ID,
        OPTIONS_ID,
    ]);
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

test("actionMenuItems called with nothing at all still offers the five items", () => {
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
            assert.equal(typeof item.title, "string");
            assert.notEqual(item.title, "");
            assert.ok(TYPES.includes(item.type), String(item.type));
            assert.equal(typeof item.checked, "boolean");
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
            } else {
                assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS);
            }
        }
    });

    test(`the five items that owe nothing to the server are there, in order (${label})`, () => {
        const items = actionMenuItems(state);

        assert.ok(items.length >= FIXED_IDS.length);
        assert.deepEqual(idsOf(items).filter((id) => FIXED_IDS.includes(id)), FIXED_IDS);
    });

    test(`the types of the five fixed items never vary (${label})`, () => {
        const items = actionMenuItems(state);

        assert.equal(itemOf(items, LANGUAGE_ID).type, "normal");
        assert.equal(itemOf(items, AUTO_ID).type, "radio");
        assert.equal(itemOf(items, PICKY_ID).type, "checkbox");
        assert.equal(itemOf(items, CHECKING_ID).type, "checkbox");
        assert.equal(itemOf(items, OPTIONS_ID).type, "normal");
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

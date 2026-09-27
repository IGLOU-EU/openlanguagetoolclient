/**
 * The contract of src/swatch.js: the colour that says what kind of mistake it is.
 *
 * A plain module, with no Thunderbird API and no DOM, so the whole mapping is
 * provable under Node where no menu exists.
 *
 * Three rules carry the rest. The family is read from `issueType`, the server's
 * own word for the kind of mistake, because it is spelled the same whatever the
 * language while a category id is named after the rule set that produced it. A
 * kind nobody recognises still gets a colour, since an item with an empty icon
 * gutter next to items that have one reads as a broken menu. And the image is
 * decoded here rather than compared against a captured string: the platform
 * accepts a menu icon only as a `data:image/png;base64,` URL and draws the
 * bitmap as given, so what has to be proved is that the bytes really are a PNG
 * of that colour, not that the function still answers what it answered
 * yesterday.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, inflateSync } from "node:zlib";

import { SWATCHES, choiceFor, familyOf, paintFor, swatchFor } from "../src/swatch.js";

/** The one prefix the menus schema accepts for an inline menu icon. */
const PREFIX = "data:image/png;base64,";

/** The eight bytes every PNG file opens with. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Truecolour with no alpha channel, which is what an opaque swatch needs. */
const COLOR_TYPE_RGB = 2;

/**
 * The five colours as they are declared.
 *
 * Spelled out here so that a change of mind is decided in src/swatch.js and
 * read back, and so that the test never computes what it is meant to check.
 */
const HEX = {
    misspelling: "#c0392b",
    grammar: "#d35400",
    typographical: "#8e44ad",
    style: "#16a085",
    other: "#1c5fd6",
};

/** The same five colours as a decoder reads them back out of the image. */
const PIXELS = {
    misspelling: [192, 57, 43],
    grammar: [211, 84, 0],
    typographical: [142, 68, 173],
    style: [22, 160, 133],
    other: [28, 95, 214],
};

/**
 * Every issue type worth naming, and the family it belongs to.
 *
 * The values are the server's, taken from the real captures under
 * `test/fixtures/` and from the localisation quality vocabulary LanguageTool
 * draws them from. Five colours is what a menu can be read at a glance with,
 * so most of the vocabulary lands in `other` and that is the point.
 */
const FAMILIES = [
    ["misspelling", "misspelling"],
    ["grammar", "grammar"],
    ["typographical", "typographical"],
    ["whitespace", "typographical"],
    ["formatting", "typographical"],
    ["style", "style"],
    ["register", "style"],
    ["locale-violation", "style"],
    ["other", "other"],
    ["uncategorized", "other"],
    ["duplication", "other"],
    ["inconsistency", "other"],
    ["characters", "other"],
    ["terminology", "other"],
    ["non-conformance", "other"],
];

/**
 * What no colour can be read out of.
 *
 * The argument comes from the table of colours, so an unusable one means the
 * table was edited badly. A menu that throws on it would take the whole right
 * click with it, and the mistake is still worth underlining in some colour.
 */
const UNUSABLE = [
    ["nothing at all", undefined],
    ["null", null],
    ["an empty string", ""],
    ["spaces", "   "],
    ["a colour name", "red"],
    ["a CSS function", "rgb(192, 57, 43)"],
    ["no leading hash", "c0392b"],
    ["the hash alone", "#"],
    ["three digits", "#c32"],
    ["five digits", "#c0392"],
    ["seven digits", "#c0392b1"],
    ["digits that are not hexadecimal", "#gggggg"],
    ["a number", 0xc0392b],
    ["true", true],
    ["false", false],
    ["an object", {}],
    ["an array", ["#c0392b"]],
    ["a swatch URL", "data:image/png;base64,AAAA"],
];

/**
 * What no issue type can be read out of.
 *
 * It arrives as a message from another context, where nothing checked it, so a
 * value of any type at all can turn up here.
 */
const NOT_A_STRING = [
    ["nothing at all", undefined],
    ["null", null],
    ["zero", 0],
    ["a number", 42],
    ["NaN", NaN],
    ["true", true],
    ["false", false],
    ["an object", {}],
    ["an empty array", []],
    ["an array holding an issue type", ["misspelling"]],
    ["a match instead of its field", { issueType: "misspelling" }],
    ["a String object", new String("misspelling")],
];

/**
 * Reads a swatch URL back into the picture it carries.
 *
 * A PNG is a signature then a chain of length-type-data-CRC chunks. Checking
 * the CRC of each one matters: a decoder is entitled to refuse a chunk whose
 * checksum is wrong, so a swatch that computes them badly would be a valid
 * looking string that draws nothing.
 */
function decode(url) {
    assert.equal(typeof url, "string");
    assert.ok(url.startsWith(PREFIX), `not a PNG data URL: ${String(url).slice(0, 40)}`);

    const bytes = Buffer.from(url.slice(PREFIX.length), "base64");
    assert.deepEqual(bytes.subarray(0, SIGNATURE.length), SIGNATURE);

    const chunks = [];
    let at = SIGNATURE.length;
    while (at < bytes.length) {
        const length = bytes.readUInt32BE(at);
        const type = bytes.toString("latin1", at + 4, at + 8);
        assert.ok(at + 12 + length <= bytes.length, `chunk ${type} runs past the end`);
        assert.equal(
            bytes.readUInt32BE(at + 8 + length),
            crc32(bytes.subarray(at + 4, at + 8 + length)),
            `CRC of the ${type} chunk`,
        );
        chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + length) });
        at += 12 + length;
    }
    assert.equal(at, bytes.length, "trailing bytes after the last chunk");

    const types = chunks.map((chunk) => chunk.type);
    assert.equal(types[0], "IHDR", "a PNG opens with IHDR");
    assert.equal(types.at(-1), "IEND", "a PNG closes with IEND");

    const header = chunks[0].data;
    assert.equal(header.length, 13, "IHDR is thirteen bytes");

    const pixels = chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data);
    assert.ok(pixels.length > 0, "no IDAT chunk, so no picture");

    return {
        types,
        width: header.readUInt32BE(0),
        height: header.readUInt32BE(4),
        bitDepth: header[8],
        colorType: header[9],
        compression: header[10],
        filter: header[11],
        interlace: header[12],
        // One scanline: the filter byte the format puts in front of every row,
        // then the row itself.
        scanline: inflateSync(Buffer.concat(pixels)),
    };
}

/** The three numbers the image is made of, filter byte dropped. */
const rgbOf = (url) => Array.from(decode(url).scanline.subarray(1));

test("SWATCHES names the five families and gives each a readable colour", () => {
    // The only test that spells the colours out, so a change of mind is decided
    // in one place. They are hexadecimal in the source precisely so that they
    // stay readable instead of being frozen into a base64 blob.
    assert.deepEqual(SWATCHES, HEX);
});

test("the hexadecimal and the decoded numbers say the same five colours", () => {
    // Both spellings are written out above, so a typo in either one shows up
    // here instead of travelling into an assertion that agrees with itself.
    for (const [family, color] of Object.entries(HEX)) {
        const pairs = [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)];

        assert.deepEqual(pairs.map((pair) => Number.parseInt(pair, 16)), PIXELS[family]);
    }
});

for (const [issueType, family] of FAMILIES) {
    test(`familyOf("${issueType}") is the ${family} family`, () => {
        assert.equal(familyOf(issueType), family);
    });
}

test("every family a familyOf answer names has a colour of its own", () => {
    // A family with no entry in the table would hand swatchFor an undefined
    // colour, which is the fallback path, so every mistake would come out blue.
    for (const [issueType, family] of FAMILIES) {
        assert.ok(family in SWATCHES, `${issueType} maps to an unknown family`);
    }
});

test("an issue type nobody has a colour for is the other family", () => {
    // LanguageTool's vocabulary is longer than five words and grows with its
    // rule sets, so the default is the ordinary case, not the exception.
    assert.equal(familyOf("what-the-server-invents-next"), "other");
    assert.equal(familyOf("mistranslation"), "other");
});

test("an empty issue type is the other family", () => {
    // What src/languagetool.js normalizes a missing `rule.issueType` to.
    assert.equal(familyOf(""), "other");
});

for (const [label, value] of [
    ["spaces alone", "   "],
    ["a tab", "\t"],
    ["a newline", "\n"],
]) {
    test(`an issue type made of ${label} is the other family`, () => {
        assert.equal(familyOf(value), "other");
    });
}

for (const [label, value, family] of [
    ["upper case", "MISSPELLING", "misspelling"],
    ["mixed case", "MisSpelling", "misspelling"],
    ["a capital on a folded type", "Whitespace", "typographical"],
    ["upper case on a hyphenated type", "LOCALE-VIOLATION", "style"],
    ["leading and trailing spaces", "  misspelling  ", "misspelling"],
    ["a tab and a newline around it", "\tgrammar\n", "grammar"],
    ["both at once", "  Locale-Violation  ", "style"],
]) {
    test(`an issue type spelled with ${label} still reads as ${family}`, () => {
        // The field crosses a server, a JSON parse and a message boundary, and
        // LanguageTool's own rule sets are not consistent about the spelling.
        assert.equal(familyOf(value), family);
    });
}

test("an issue type that merely contains a family name is not that family", () => {
    // locale-specific-content is a real value and it is not locale-violation.
    // Matching on a prefix or a substring would put it in the style family.
    assert.equal(familyOf("locale-specific-content"), "other");
    assert.equal(familyOf("style-guide"), "other");
    assert.equal(familyOf("misspellings"), "other");
    assert.equal(familyOf("a grammar problem"), "other");
});

for (const [label, value] of NOT_A_STRING) {
    test(`an issue type that is no string (${label}) is the other family`, () => {
        // It arrives as a message from another context, and a menu that throws
        // would take the whole right click with it.
        assert.doesNotThrow(() => familyOf(value));
        assert.equal(familyOf(value), "other");
    });
}

test("familyOf always answers one of the five keys of SWATCHES", () => {
    const keys = Object.keys(SWATCHES);

    for (const value of [...FAMILIES.map(([issueType]) => issueType), "", "  ", null, 42, {}]) {
        assert.ok(keys.includes(familyOf(value)), `familyOf(${String(value)})`);
    }
});

test("a swatch is a PNG data URL, which is the one thing the platform accepts", () => {
    // Measured on the shipped binary: the menus schema takes a relative path, a
    // moz-extension, blob or http(s) URL, or a data URL whose prefix is exactly
    // data:image/png;base64, or data:image/jpeg;base64,. An SVG data URL is
    // refused outright, so the prefix is not a detail.
    for (const color of Object.values(SWATCHES)) {
        assert.ok(swatchFor(color).startsWith(PREFIX), color);
    }
});

test("a swatch is one pixel by one pixel, eight bits, truecolour", () => {
    for (const [family, color] of Object.entries(SWATCHES)) {
        const image = decode(swatchFor(color));

        assert.equal(image.width, 1, family);
        assert.equal(image.height, 1, family);
        assert.equal(image.bitDepth, 8, family);
        assert.equal(image.colorType, COLOR_TYPE_RGB, family);
        assert.equal(image.compression, 0, family);
        assert.equal(image.filter, 0, family);
        assert.equal(image.interlace, 0, family);
    }
});

test("a swatch holds exactly the colour it was asked for", () => {
    for (const [family, color] of Object.entries(SWATCHES)) {
        assert.deepEqual(rgbOf(swatchFor(color)), PIXELS[family], family);
    }
});

test("a swatch is one row: the filter byte, then one triplet", () => {
    const image = decode(swatchFor(SWATCHES.misspelling));

    assert.equal(image.scanline.length, 4);
    // Filter type zero, the row kept as it is. Anything else would have the
    // decoder subtract a neighbour that does not exist.
    assert.equal(image.scanline[0], 0);
});

test("a swatch is opaque: no alpha channel and no transparency chunk", () => {
    // A translucent swatch over a menu background the extension cannot read
    // would come out as an unpredictable colour, which defeats the point.
    for (const color of Object.values(SWATCHES)) {
        const image = decode(swatchFor(color));

        assert.equal(image.colorType, COLOR_TYPE_RGB);
        assert.ok(!image.types.includes("tRNS"), "a tRNS chunk makes a colour transparent");
        assert.ok(!image.types.includes("PLTE"), "a palette is not a truecolour image");
    }
});

test("a colour no family uses is drawn all the same", () => {
    // The proof that the image is built from the colour rather than picked from
    // a handful of frozen blobs, which is what keeps the colours editable.
    assert.deepEqual(rgbOf(swatchFor("#010203")), [1, 2, 3]);
    assert.deepEqual(rgbOf(swatchFor("#000000")), [0, 0, 0]);
    assert.deepEqual(rgbOf(swatchFor("#ffffff")), [255, 255, 255]);
    assert.deepEqual(rgbOf(swatchFor("#00ff80")), [0, 255, 128]);
});

test("the five families give five different swatches", () => {
    const urls = Object.values(SWATCHES).map((color) => swatchFor(color));

    // Five colours that came out as one string would mean the menu says nothing
    // about the kind of mistake, which is the whole reason for the icon.
    assert.equal(new Set(urls).size, 5);
});

test("the same colour twice gives the same URL", () => {
    // The event page persists the properties of every menu item to disk, so an
    // answer that varied between two calls would rewrite the store for nothing.
    for (const color of Object.values(SWATCHES)) {
        assert.equal(swatchFor(color), swatchFor(color));
    }
    assert.equal(swatchFor("#010203"), swatchFor("#010203"));
});

test("upper and lower case hexadecimal are the same colour", () => {
    assert.equal(swatchFor("#C0392B"), swatchFor("#c0392b"));
    assert.equal(swatchFor("#8E44AD"), swatchFor("#8e44ad"));
    assert.equal(swatchFor("#00FF80"), swatchFor("#00ff80"));
    assert.deepEqual(rgbOf(swatchFor("#C0392B")), PIXELS.misspelling);
    assert.deepEqual(rgbOf(swatchFor("#AbCdEf")), [171, 205, 239]);
});

for (const [label, color] of UNUSABLE) {
    test(`a colour that is unusable (${label}) falls back to the other family`, () => {
        // Throwing here would lose the whole menu over a swatch, and an item
        // with an empty icon gutter beside items that have one reads as broken.
        assert.doesNotThrow(() => swatchFor(color));
        assert.equal(swatchFor(color), swatchFor(SWATCHES.other));
        assert.deepEqual(rgbOf(swatchFor(color)), PIXELS.other);
    });
}

test("the fallback is the other family's colour, not black and not white", () => {
    // Black or white would read as a missing icon rather than as a kind of
    // mistake nobody named.
    const fallback = rgbOf(swatchFor(undefined));

    assert.deepEqual(fallback, PIXELS.other);
    assert.notDeepEqual(fallback, [0, 0, 0]);
    assert.notDeepEqual(fallback, [255, 255, 255]);
});

test("the two functions compose into a colour for any issue type at all", () => {
    // How src/menu.js uses them, so the pair is proved to work together and not
    // only apart.
    for (const value of ["misspelling", "WHITESPACE", "uncategorized", "", null, 42, {}]) {
        const url = swatchFor(SWATCHES[familyOf(value)]);

        assert.ok(url.startsWith(PREFIX), String(value));
        assert.equal(decode(url).width, 1);
    }
    assert.deepEqual(rgbOf(swatchFor(SWATCHES[familyOf("misspelling")])), PIXELS.misspelling);
    assert.deepEqual(rgbOf(swatchFor(SWATCHES[familyOf("uncategorized")])), PIXELS.other);
});

// What the panel shows for one mistake, where the menu shows an icon. The panel
// has no icon gutter and no PNG to build: it needs the colour as a CSS value and
// a word for the kind of mistake. Both come out of the same family as the
// underline the user clicked, or the panel would name one thing while the text
// marks another.

/**
 * The five words the panel shows.
 *
 * The one place they are spelled out, so a change of wording is decided in
 * src/swatch.js and read back here. They are deliberately not the family keys:
 * `misspelling` and `typographical` belong to the localisation quality
 * vocabulary the server draws on, and the panel is read by whoever is writing
 * the message.
 */
const LABELS = {
    misspelling: "Spelling",
    grammar: "Grammar",
    typographical: "Typography",
    style: "Style",
    other: "Other",
};

test("paintFor gives each family its colour and the word a human reads", () => {
    // The only test that spells the five words out, so the wording lives in one
    // place here as the colours do in SWATCHES.
    assert.deepEqual(Object.keys(LABELS).sort(), Object.keys(SWATCHES).sort());

    for (const family of Object.keys(SWATCHES)) {
        assert.deepEqual(paintFor(family), { color: SWATCHES[family], label: LABELS[family] });
    }
});

test("paintFor answers a colour and a label, and nothing else", () => {
    for (const value of [...FAMILIES.map(([issueType]) => issueType), "", "  ", null, 42, {}]) {
        const paint = paintFor(value);

        assert.deepEqual(Object.keys(paint).sort(), ["color", "label"], String(value));
        assert.ok(Object.values(SWATCHES).includes(paint.color), String(value));
        assert.ok(Object.values(LABELS).includes(paint.label), String(value));
    }
});

for (const [issueType, family] of FAMILIES) {
    test(`paintFor("${issueType}") paints the ${family} family`, () => {
        // Read back through familyOf and SWATCHES rather than written out again:
        // the panel's colour and the menu's icon are the same colour, and a pair
        // that drifted from the table would say what the underline does not.
        assert.equal(paintFor(issueType).color, SWATCHES[familyOf(issueType)]);
        assert.deepEqual(paintFor(issueType), paintFor(family));
    });
}

test("an issue type nobody has a colour for is painted as the other family", () => {
    // LanguageTool's vocabulary is longer than five words and grows with its
    // rule sets, so the default is the ordinary case, not the exception.
    // locale-specific-content is a real value and it is not locale-violation, so
    // a family matched on a substring would paint it as the style family.
    for (const value of [
        "what-the-server-invents-next",
        "mistranslation",
        "locale-specific-content",
    ]) {
        assert.deepEqual(paintFor(value), paintFor("other"));
        assert.equal(paintFor(value).color, SWATCHES.other);
    }
});

test("an empty issue type is painted as the other family", () => {
    // What src/languagetool.js normalizes a missing `rule.issueType` to.
    assert.deepEqual(paintFor(""), paintFor("other"));
});

for (const [label, value] of [
    ["spaces alone", "   "],
    ["a tab", "\t"],
    ["a newline", "\n"],
]) {
    test(`an issue type made of ${label} is painted as the other family`, () => {
        assert.deepEqual(paintFor(value), paintFor("other"));
    });
}

for (const [label, value, family] of [
    ["upper case", "MISSPELLING", "misspelling"],
    ["mixed case", "MisSpelling", "misspelling"],
    ["a capital on a folded type", "Whitespace", "typographical"],
    ["upper case on a hyphenated type", "LOCALE-VIOLATION", "style"],
    ["leading and trailing spaces", "  misspelling  ", "misspelling"],
    ["both at once", "  Locale-Violation  ", "style"],
]) {
    test(`an issue type spelled with ${label} is still painted as ${family}`, () => {
        assert.deepEqual(paintFor(value), paintFor(family));
        assert.equal(paintFor(value).color, SWATCHES[family]);
    });
}

for (const [label, value] of NOT_A_STRING) {
    test(`an issue type that is no string (${label}) is painted as the other family`, () => {
        // A panel that threw here would swallow the click that asked for it, and
        // the user would be left with an underline that answers nothing.
        assert.doesNotThrow(() => paintFor(value));
        assert.deepEqual(paintFor(value), paintFor("other"));
    });
}

test("the five families give five different colours and five different labels", () => {
    const paints = Object.keys(SWATCHES).map((family) => paintFor(family));

    // One colour used twice would make the underline unreadable, and one label
    // used twice would have the panel call two kinds of mistake by one name.
    assert.equal(new Set(paints.map((paint) => paint.color)).size, 5);
    assert.equal(new Set(paints.map((paint) => paint.label)).size, 5);
});

test("a label is a word a reader recognises, not the family it comes from", () => {
    for (const family of Object.keys(SWATCHES)) {
        const { label } = paintFor(family);

        assert.notEqual(label, family);
        assert.ok(/^[A-Z][a-z]+$/.test(label), label);
    }
});

test("paintFor and swatchFor agree on the colour of every issue type", () => {
    // The panel writes the colour into a style and the menu draws it as a one
    // pixel PNG. The same mistake has to come out the same colour in both, and
    // this is also what proves the pair carries a colour swatchFor accepts:
    // anything else would fall back to the other family's blue here.
    for (const [issueType] of FAMILIES) {
        const paint = paintFor(issueType);

        assert.equal(swatchFor(paint.color), swatchFor(SWATCHES[familyOf(issueType)]));
        assert.deepEqual(rgbOf(swatchFor(paint.color)), PIXELS[familyOf(issueType)]);
    }
});

// What the panel writes as the heading of a mistake, when the server named the
// category itself. The name arrives in the language the text was checked in,
// which is the language being written, and it tells a homonym from a typo where
// the five families fold both into one word. It is better than this file's
// English on both counts, so the English stays as what is read when the server
// named nothing. The colour does not move with it: only issueType means the same
// thing whatever the language, and the underline is keyed on that.

/**
 * Category names as the server really sends them.
 *
 * The three in the captures under `test/fixtures/` and four more the same server
 * answers for French. This is what a name looks like: prose in the language of
 * the check, sometimes several words, accents and typographic apostrophe
 * included, nothing like the upper case identifier the category is filed under.
 */
const CATEGORY_NAMES = [
    "Faute de frappe possible",
    "Confusion d’homonymes et paronymes",
    "Concordances",
    "Majuscules",
    "Pléonasmes",
    "Possible Typo",
    "Miscellaneous",
];

/**
 * What no category name can be read out of.
 *
 * It crosses a server, a JSON parse and a message boundary before it gets here.
 * Whitespace counts as nothing said: a heading of three spaces is an empty
 * heading that took the room of a word.
 */
const NOT_A_CATEGORY_NAME = [
    ["nothing at all", undefined],
    ["null", null],
    ["an empty string", ""],
    ["one space", " "],
    ["spaces alone", "   "],
    ["a tab", "\t"],
    ["a newline", "\n"],
    ["a no break space", "\u00a0"],
    ["a number", 42],
    ["zero", 0],
    ["true", true],
    ["false", false],
    ["an object", {}],
    ["an array", ["Concordances"]],
    ["the category instead of its name", { name: "Concordances" }],
    ["a String object", new String("Concordances")],
];

/** Both columns of NOT_A_CATEGORY_NAME and CATEGORY_NAMES, as second arguments. */
const EVERY_NAME = [...CATEGORY_NAMES, ...NOT_A_CATEGORY_NAME.map(([, name]) => name)];

test("nothing but a usable category name changes what the label says", () => {
    // The one argument call is what the event page makes today and what every
    // test above reads, so the widened signature has to leave it where it was.
    for (const [issueType, family] of FAMILIES) {
        assert.equal(paintFor(issueType).label, LABELS[family]);
        assert.equal(paintFor(issueType, undefined).label, LABELS[family]);
        assert.equal(paintFor(issueType, "Concordances").label, "Concordances");
    }
});

test("the name the server gave the category is what the panel reads", () => {
    for (const name of CATEGORY_NAMES) {
        assert.equal(paintFor("misspelling", name).label, name);
        // Including for a mistake of no family at all, where the English word
        // would have been the least useful of the five.
        assert.equal(paintFor("", name).label, name);
    }
});

test("the name replaces the English word, it is not added to it", () => {
    // A heading carrying both would say the same thing twice in two languages.
    const { label } = paintFor("misspelling", "Faute de frappe possible");

    assert.equal(label, "Faute de frappe possible");
    assert.ok(!label.includes(LABELS.misspelling));
});

test("the name wins even when it names something other than the family", () => {
    // The server groups its rules its own way, and the five families reduce the
    // issue types, not the categories. A name that only won where the two agreed
    // would never be read at all.
    assert.equal(paintFor("misspelling", "Concordances").label, "Concordances");
    assert.equal(paintFor("style", "Majuscules").label, "Majuscules");
    assert.equal(paintFor("uncategorized", "Pléonasmes").label, "Pléonasmes");
});

for (const [label, name] of NOT_A_CATEGORY_NAME) {
    test(`a category name that is unusable (${label}) leaves the family's word`, () => {
        // The panel is opened by a click the user made, so a throw here would
        // swallow the answer they asked for.
        assert.doesNotThrow(() => paintFor("misspelling", name));
        assert.deepEqual(paintFor("misspelling", name), paintFor("misspelling"));
        assert.equal(paintFor("misspelling", name).label, LABELS.misspelling);
        assert.equal(paintFor("mistranslation", name).label, LABELS.other);
    });
}

test("a name surrounded by spaces is still the name and not the English word", () => {
    // The trim decides whether anything was said, and something was said here.
    const { label } = paintFor("misspelling", "  Concordances  ");

    assert.equal(label.trim(), "Concordances");
    assert.notEqual(label, LABELS.misspelling);
});

test("the colour is the family's whatever the second argument says", () => {
    // The underline is drawn from the issue type alone, and a panel whose dot
    // followed the category name would name one thing while the text marks
    // another.
    for (const [issueType, family] of FAMILIES) {
        for (const name of EVERY_NAME) {
            assert.equal(paintFor(issueType, name).color, SWATCHES[family], issueType);
        }
    }
});

test("two families given one name keep their two colours", () => {
    const typo = paintFor("misspelling", "Concordances");
    const style = paintFor("style", "Concordances");

    assert.equal(typo.label, style.label);
    assert.notEqual(typo.color, style.color);
});

test("paintFor with a name still answers a colour and a label, and nothing else", () => {
    for (const [issueType] of FAMILIES) {
        for (const name of EVERY_NAME) {
            const paint = paintFor(issueType, name);

            assert.deepEqual(Object.keys(paint).sort(), ["color", "label"], issueType);
            assert.equal(typeof paint.label, "string");
            assert.notEqual(paint.label.trim(), "");
            assert.ok(Object.values(SWATCHES).includes(paint.color), issueType);
        }
    }
});

// How one replacement is shown, where until now the value was drawn as it came.
// A replacement that deletes something is the empty string, and a replacement
// that inserts a space is a space: drawn as they are, the first is a button with
// no caption and a menu line with no text, the second is a button the width of a
// space. A click target nobody can see is worse than no suggestion at all. The
// two signs below stand for what has no glyph of its own, and neither belongs to
// any language, which is what lets them say the same thing in all of them.

/** U+2423 OPEN BOX, one per whitespace character that would be drawn as nothing. */
const OPEN_BOX = "␣";

/** U+2205 EMPTY SET, for a deletion whose covered text says nothing usable. */
const EMPTY_SET = "∅";

/** The text the mistake covers, four characters as the capture's offsets say. */
const COVERED = "cafe";

/**
 * Every replacement worth showing, as a value really arrives.
 *
 * The empty one is a rule that deletes, a single space is a rule that separates,
 * and the padded ones are a rule that moves a space from one side of a word to
 * the other. All three are ordinary LanguageTool suggestions.
 */
const EVERY_VALUE = ["café", "un café", " café ", "   café", "café\t", " ", "   ", "\t\u00a0", ""];

/** Every covered text one can arrive with, usable or not. */
const EVERY_COVERED = ["cafe", "un cafe", " cafe ", "", "   ", undefined, null, 42, {}, ["cafe"]];

/**
 * What no replacement can be read out of.
 *
 * `src/languagetool.js` keeps only the strings, but the match crosses a message
 * boundary and an older cached one predates that. The object the server actually
 * sends is in the list, because a raw one arriving here must read as nothing
 * rather than as the words "[object Object]" written into the message.
 */
const NOT_A_REPLACEMENT = [
    ["nothing at all", undefined],
    ["null", null],
    ["zero", 0],
    ["a number", 42],
    ["NaN", NaN],
    ["true", true],
    ["false", false],
    ["an object", {}],
    ["an empty array", []],
    ["an array holding a replacement", ["café"]],
    ["the replacement object the server sends", { value: "café" }],
    ["a String object", new String("café")],
];

/**
 * A replacement and what is shown for it, the covered text playing no part.
 *
 * Only the whitespace at the two ends is marked. A suggestion of several words
 * has ordinary spaces inside it, and boxing those would make it unreadable.
 */
const SHOWN = [
    ["an ordinary word", "café", "café"],
    ["a single letter", "à", "à"],
    ["a punctuation mark", ",", ","],
    ["several words", "un café", "un café"],
    ["two spaces inside", "un  café", "un  café"],
    ["a whole sentence", "Il a mangé une pomme", "Il a mangé une pomme"],
    ["one leading space", " café", `${OPEN_BOX}café`],
    ["one trailing space", "café ", `café${OPEN_BOX}`],
    ["one space at each end", " café ", `${OPEN_BOX}café${OPEN_BOX}`],
    ["three leading spaces", "   café", `${OPEN_BOX.repeat(3)}café`],
    ["two trailing spaces", "café  ", `café${OPEN_BOX.repeat(2)}`],
    ["two and three spaces", "  café   ", `${OPEN_BOX.repeat(2)}café${OPEN_BOX.repeat(3)}`],
    ["a leading tab", "\tcafé", `${OPEN_BOX}café`],
    ["a trailing no break space", "café\u00a0", `café${OPEN_BOX}`],
    ["a newline at each end", "\ncafé\n", `${OPEN_BOX}café${OPEN_BOX}`],
    [
        "mixed whitespace at both ends",
        "\t\u00a0 café \n",
        `${OPEN_BOX.repeat(3)}café${OPEN_BOX.repeat(2)}`,
    ],
    ["a narrow no break space before a colon", "\u202f:", `${OPEN_BOX}:`],
    ["words that keep their own space", " un café ", `${OPEN_BOX}un café${OPEN_BOX}`],
    ["one space alone", " ", OPEN_BOX],
    ["two spaces alone", "  ", OPEN_BOX.repeat(2)],
    ["four spaces alone", "    ", OPEN_BOX.repeat(4)],
    ["a tab alone", "\t", OPEN_BOX],
    ["a no break space alone", "\u00a0", OPEN_BOX],
    ["whitespace of mixed kinds alone", " \t\u00a0\n", OPEN_BOX.repeat(4)],
];

test("the two signs are the open box and the empty set, and no letter", () => {
    // The one test that pins them, so a change of mind is decided in
    // src/swatch.js and read back here. A look-alike would pass the eye and fail
    // the reader: the point of both is that they are not words of any language,
    // and that neither can be mistaken for the replacement itself.
    assert.equal(OPEN_BOX.codePointAt(0), 0x2423);
    assert.equal(EMPTY_SET.codePointAt(0), 0x2205);
    assert.equal(OPEN_BOX.length, 1);
    assert.equal(EMPTY_SET.length, 1);
    assert.notEqual(OPEN_BOX.trim(), "");
    assert.notEqual(EMPTY_SET.trim(), "");
});

test("a choice is the value to write, the text to show, and whether it is struck", () => {
    assert.deepEqual(choiceFor("café", COVERED), { value: "café", text: "café", struck: false });
});

for (const [label, value, text] of SHOWN) {
    test(`a replacement of ${label} is shown as ${text}`, () => {
        const choice = choiceFor(value, COVERED);

        assert.equal(choice.text, text);
        assert.equal(choice.value, value);
        assert.equal(choice.struck, false);
    });
}

test("the open box marks the two ends and never the inside", () => {
    // The mutation this exists to catch: every whitespace character boxed would
    // turn a two word suggestion into something nobody can read.
    assert.equal(choiceFor("un café", COVERED).text, "un café");
    assert.equal(choiceFor(" un café ", COVERED).text, `${OPEN_BOX}un café${OPEN_BOX}`);
    assert.equal(choiceFor("un  café", COVERED).text, "un  café");
    assert.ok(!choiceFor("un café", COVERED).text.includes(OPEN_BOX));
});

test("a replacement of nothing but whitespace is that many boxes, and not struck", () => {
    // One box per character, because a rule that asks for two spaces and one that
    // asks for one are two different suggestions and the button is all the user
    // has to tell them apart. Nothing is deleted here, so nothing is struck.
    assert.deepEqual(choiceFor(" ", COVERED), { value: " ", text: OPEN_BOX, struck: false });
    assert.deepEqual(choiceFor("  ", COVERED), {
        value: "  ",
        text: `${OPEN_BOX}${OPEN_BOX}`,
        struck: false,
    });
    assert.equal(choiceFor(" ", COVERED).text.length, 1);
    assert.equal(choiceFor("  ", COVERED).text.length, 2);
    assert.equal(choiceFor("     ", COVERED).text.length, 5);
});

test("a replacement that deletes is the covered text, struck through", () => {
    // Which says it will disappear without a word in any language, where the
    // empty string is a button nobody can see and a menu line nobody can read.
    assert.deepEqual(choiceFor("", COVERED), { value: "", text: COVERED, struck: true });
});

test("a deletion shows everything it removes, inner spaces included", () => {
    assert.equal(choiceFor("", "un cafe").text, "un cafe");
    assert.equal(choiceFor("", ",").text, ",");
    assert.equal(choiceFor("", "Il a manger").text, "Il a manger");
});

for (const [label, covered] of [
    ["nothing at all", undefined],
    ["null", null],
    ["an empty string", ""],
    ["one space", " "],
    ["spaces alone", "   "],
    ["a tab", "\t"],
    ["a no break space", "\u00a0"],
    ["a number", 42],
    ["true", true],
    ["an object", {}],
    ["an array holding the text", ["cafe"]],
    ["a String object", new String("cafe")],
]) {
    test(`a deletion covering nothing usable (${label}) shows the empty set`, () => {
        // There is still something to click, and it still says that clicking
        // removes something.
        assert.deepEqual(choiceFor("", covered), { value: "", text: EMPTY_SET, struck: true });
    });
}

test("the covered text is read for a deletion and for nothing else", () => {
    // The mutation this exists to catch: a text taken from the covered words
    // whatever the replacement would write the mistake back into the message.
    const elsewhere = "whatever the mistake covered";

    assert.equal(choiceFor("café", elsewhere).text, "café");
    assert.equal(choiceFor(" ", elsewhere).text, OPEN_BOX);
    assert.equal(choiceFor(" café ", elsewhere).text, `${OPEN_BOX}café${OPEN_BOX}`);
});

test("a replacement stands on its own with no covered text at all", () => {
    // The menu and the panel both call it with what they have, and an older
    // cached match has no covered text to give.
    assert.deepEqual(choiceFor("café"), { value: "café", text: "café", struck: false });
    assert.deepEqual(choiceFor(" "), { value: " ", text: OPEN_BOX, struck: false });
    assert.deepEqual(choiceFor(""), { value: "", text: EMPTY_SET, struck: true });
});

for (const [label, value] of NOT_A_REPLACEMENT) {
    test(`a replacement that is no string (${label}) gives nothing to show`, () => {
        // Which is what the callers already skip, and the one answer that is not
        // an object: only a string can be written into the message.
        for (const covered of EVERY_COVERED) {
            assert.doesNotThrow(() => choiceFor(value, covered));
            assert.equal(choiceFor(value, covered), null);
        }
    });
}

test("a choice carries a value, a text and a flag, and nothing else", () => {
    for (const value of EVERY_VALUE) {
        for (const covered of EVERY_COVERED) {
            const choice = choiceFor(value, covered);

            assert.deepEqual(Object.keys(choice).sort(), ["struck", "text", "value"], value);
            assert.equal(typeof choice.text, "string");
            assert.equal(typeof choice.struck, "boolean");
        }
    }
});

test("the value comes back exactly as the server sent it", () => {
    // It is what gets written into the message. A value the panel had tidied up
    // on the way would insert the tidied one instead of the suggestion.
    for (const value of EVERY_VALUE) {
        for (const covered of EVERY_COVERED) {
            assert.equal(choiceFor(value, covered).value, value);
        }
    }
});

test("what a choice shows is never empty, which is the whole point", () => {
    for (const value of EVERY_VALUE) {
        for (const covered of EVERY_COVERED) {
            const { text } = choiceFor(value, covered);

            assert.notEqual(text, "");
            assert.notEqual(text.trim(), "");
        }
    }
});

test("struck is set for a deletion and for nothing else", () => {
    for (const value of EVERY_VALUE) {
        for (const covered of EVERY_COVERED) {
            assert.equal(choiceFor(value, covered).struck, value === "", value);
        }
    }
});

test("choiceFor never throws, whatever the pair", () => {
    // The panel is opened by a click and the menu is built while it is already on
    // screen, so a throw here costs the user the answer they asked for.
    const anything = [...EVERY_VALUE, ...NOT_A_REPLACEMENT.map(([, value]) => value)];

    for (const value of anything) {
        for (const covered of anything) {
            assert.doesNotThrow(() => choiceFor(value, covered), String(value));
        }
    }
});

test("choiceFor leaves the caller's replacement alone", () => {
    // The list belongs to the match the compose script holds and the cache keeps,
    // and the next click on the same word reads it again.
    const replacements = ["", " ", " café "];
    const before = structuredClone(replacements);

    for (const value of replacements) {
        choiceFor(value, COVERED);
    }

    assert.deepEqual(replacements, before);
});

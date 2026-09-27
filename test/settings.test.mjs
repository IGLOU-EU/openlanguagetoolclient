/**
 * The contract of src/settings.js: what the options page may store, and what
 * the event page may rely on reading back.
 *
 * A module with no Thunderbird API, no DOM and no network, so every rule is
 * provable under Node. The settings come back from `browser.storage.local`,
 * which hands over whatever was written into it, including what an older
 * version of the extension wrote and what a hand-edited profile holds. A shape
 * nobody meant to store is the ordinary case here, not an exotic one.
 *
 * Two readings of the contract are pinned here, each stated above the tests
 * that hold it: the trim happens before the trailing slashes are cut, and a
 * language that falls back to "auto" keeps its preferred variants.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULTS, normalize, originOf, problemsWith } from "../src/settings.js";

/** The keys a settings object carries, sorted the way Object.keys gives them back. */
const SETTINGS_KEYS = ["language", "motherTongue", "picky", "preferredVariants", "url"];

/** Settings as a filled options page yields them, every field usable. */
const GOOD = {
    url: "https://lt.example/v2",
    language: "auto",
    motherTongue: "fr",
    preferredVariants: ["fr-FR", "en-US"],
    picky: true,
};

/**
 * Values that are no string at all, as storage can hand them back.
 *
 * The array holds a plausible address on purpose: coerced to a string it would
 * parse as a URL, so a field read without a type check would let it through.
 */
const NOT_STRINGS = [
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["a boolean", true],
    ["an object", {}],
    ["an array", ["https://lt.example/v2"]],
];

/** Strings that carry no value, which is not the same as carrying none. */
const BLANKS = [
    ["an empty string", ""],
    ["spaces only", "   "],
    ["a tab and a line break", "\t\n"],
];

test("DEFAULTS is the settings of an extension nobody has configured", () => {
    // The only test that spells the defaults out, so a change of default is
    // decided here and nowhere else.
    assert.deepEqual(DEFAULTS, {
        url: "",
        language: "auto",
        motherTongue: "",
        preferredVariants: [],
        picky: false,
    });
});

test("DEFAULTS carries the five keys and nothing else", () => {
    assert.deepEqual(Object.keys(DEFAULTS).sort(), SETTINGS_KEYS);
});

test("normalize of nothing gives the defaults back", () => {
    assert.deepEqual(normalize(), DEFAULTS);
    assert.deepEqual(normalize(undefined), DEFAULTS);
    assert.deepEqual(normalize(null), DEFAULTS);
});

test("normalize never hands out DEFAULTS itself", () => {
    // A result sharing the defaults object, or its list, would let one caller's
    // edit change what every later call returns.
    const settings = normalize();

    assert.notStrictEqual(settings, DEFAULTS);
    assert.notStrictEqual(settings.preferredVariants, DEFAULTS.preferredVariants);
});

test("complete settings come back as they were given", () => {
    assert.deepEqual(normalize(GOOD), GOOD);
});

for (const key of SETTINGS_KEYS) {
    test(`a missing ${key} takes its default, the other fields stand`, () => {
        const raw = { ...GOOD };
        delete raw[key];

        assert.deepEqual(normalize(raw), { ...GOOD, [key]: DEFAULTS[key] });
    });
}

for (const [label, url] of [...NOT_STRINGS, ...BLANKS]) {
    test(`a url that is ${label} gives the empty address`, () => {
        assert.equal(normalize({ ...GOOD, url }).url, "");
    });
}

/**
 * The address is trimmed first and cut afterwards. Cutting first would leave
 * the slash of "  https://lt.example/v2/  " in place, because the string does
 * not end on it, and every request would then be sent to a doubled slash.
 */
for (const [label, url, expected] of [
    ["one trailing slash", "https://lt.example/v2/", "https://lt.example/v2"],
    ["several trailing slashes", "https://lt.example/v2///", "https://lt.example/v2"],
    ["a host and one slash", "https://lt.example/", "https://lt.example"],
    ["surrounding spaces", "  https://lt.example/v2  ", "https://lt.example/v2"],
    ["spaces and a trailing slash", "  https://lt.example/v2/  ", "https://lt.example/v2"],
    ["a tab and a line break", "\thttps://lt.example/v2/\n", "https://lt.example/v2"],
    ["nothing but slashes", "///", ""],
    ["a doubled slash in the middle", "https://lt.example//v2", "https://lt.example//v2"],
    ["nothing to change", "https://lt.example/v2", "https://lt.example/v2"],
]) {
    test(`a url with ${label} is stored as ${JSON.stringify(expected)}`, () => {
        assert.equal(normalize({ ...GOOD, url }).url, expected);
    });
}

for (const [label, language] of [...NOT_STRINGS, ...BLANKS]) {
    test(`a language that is ${label} falls back to auto`, () => {
        assert.equal(normalize({ ...GOOD, language }).language, "auto");
    });
}

test("a language loses its spaces and keeps its case", () => {
    // The server knows "en-US", not "en-us", so nothing here may lower the case.
    assert.equal(normalize({ ...GOOD, language: "  en-US  " }).language, "en-US");
});

for (const [label, motherTongue] of [...NOT_STRINGS, ...BLANKS]) {
    test(`a motherTongue that is ${label} becomes empty`, () => {
        assert.equal(normalize({ ...GOOD, motherTongue }).motherTongue, "");
    });
}

test("a motherTongue loses its spaces and keeps its case", () => {
    assert.equal(normalize({ ...GOOD, motherTongue: " en-GB " }).motherTongue, "en-GB");
});

for (const [label, picky] of [
    ["undefined", undefined],
    ["null", null],
    ["one", 1],
    ["zero", 0],
    ["the string true", "true"],
    ["the string false", "false"],
    ["an empty string", ""],
    ["an object", {}],
    ["an array", [true]],
]) {
    test(`a picky that is ${label} becomes false`, () => {
        // A checkbox stored as text is the likely case, and "false" read as
        // truthy would turn picky mode on for someone who turned it off.
        assert.equal(normalize({ ...GOOD, picky }).picky, false);
    });
}

test("picky true and picky false are kept as they are", () => {
    assert.equal(normalize({ ...GOOD, picky: true }).picky, true);
    assert.equal(normalize({ ...GOOD, picky: false }).picky, false);
});

for (const [label, preferredVariants] of [
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["a boolean", true],
    ["an object", {}],
    ["an empty string", ""],
    ["a comma-separated string", "fr-FR,en-US"],
]) {
    test(`preferredVariants that are ${label} become an empty list`, () => {
        // A text field holding a comma list is the likely mistake, and a string
        // read as a list would send its characters one by one.
        assert.deepEqual(normalize({ ...GOOD, preferredVariants }).preferredVariants, []);
    });
}

test("an empty preferredVariants stays empty", () => {
    assert.deepEqual(normalize({ ...GOOD, preferredVariants: [] }).preferredVariants, []);
});

test("preferredVariants keep the order they were given", () => {
    const settings = normalize({ ...GOOD, preferredVariants: ["en-US", "de-DE", "fr-FR"] });

    // The order is the order of preference, so sorting it would change what is
    // being asked for.
    assert.deepEqual(settings.preferredVariants, ["en-US", "de-DE", "fr-FR"]);
});

test("preferredVariants lose their duplicates and keep the first position", () => {
    const settings = normalize({
        ...GOOD,
        preferredVariants: ["fr-FR", "en-US", "fr-FR", "de-DE", "en-US"],
    });

    assert.deepEqual(settings.preferredVariants, ["fr-FR", "en-US", "de-DE"]);
});

test("preferredVariants are trimmed before their duplicates are counted", () => {
    // Trimming afterwards would keep " fr-FR " and "fr-FR" as two variants, and
    // the same one would be asked for twice.
    const settings = normalize({
        ...GOOD,
        preferredVariants: [" fr-FR ", "fr-FR", "\ten-US\n"],
    });

    assert.deepEqual(settings.preferredVariants, ["fr-FR", "en-US"]);
});

test("preferredVariants drop what is no usable variant", () => {
    const settings = normalize({
        ...GOOD,
        preferredVariants: ["fr-FR", "", "   ", null, 42, true, {}, [], undefined, "en-US"],
    });

    assert.deepEqual(settings.preferredVariants, ["fr-FR", "en-US"]);
});

test("preferredVariants made of nothing usable become an empty list", () => {
    const settings = normalize({
        ...GOOD,
        preferredVariants: ["", "   ", null, 42, true, {}, [], undefined],
    });

    assert.deepEqual(settings.preferredVariants, []);
});

/**
 * The rule this module exists for.
 *
 * The server answers a 400 when preferredVariants comes with an explicit
 * language, and a check that ends on a 400 reports nothing at all, so the
 * combination has to be impossible to store in the first place.
 */
test("preferredVariants survive the language auto, the one case the server takes", () => {
    const settings = normalize({ ...GOOD, language: "auto", preferredVariants: ["fr-FR"] });

    assert.equal(settings.language, "auto");
    assert.deepEqual(settings.preferredVariants, ["fr-FR"]);
});

test("preferredVariants are dropped when the language is fr", () => {
    const settings = normalize({ ...GOOD, language: "fr", preferredVariants: ["fr-FR"] });

    assert.equal(settings.language, "fr");
    assert.deepEqual(settings.preferredVariants, []);
});

for (const language of ["fr", "fr-FR", "en-US", "de-DE", "pt-BR", "zz-ZZ"]) {
    test(`preferredVariants are dropped with the explicit language ${language}`, () => {
        const settings = normalize({
            ...GOOD,
            language,
            preferredVariants: ["fr-FR", "en-US"],
        });

        assert.deepEqual(settings.preferredVariants, []);
    });
}

test("a language spelled auto with spaces around it keeps the variants", () => {
    // The comparison is made on the trimmed language, or " auto " would lose
    // variants the server would have accepted.
    const settings = normalize({ ...GOOD, language: " auto ", preferredVariants: ["fr-FR"] });

    assert.equal(settings.language, "auto");
    assert.deepEqual(settings.preferredVariants, ["fr-FR"]);
});

test("a language with spaces around an explicit code drops the variants", () => {
    const settings = normalize({ ...GOOD, language: "  fr  ", preferredVariants: ["fr-FR"] });

    assert.equal(settings.language, "fr");
    assert.deepEqual(settings.preferredVariants, []);
});

test("a language spelled AUTO is not auto, and the variants go", () => {
    // "auto" is a keyword of the server's API, not a word, so the comparison is
    // exact and an upper case spelling is an explicit language like any other.
    const settings = normalize({ ...GOOD, language: "AUTO", preferredVariants: ["fr-FR"] });

    assert.equal(settings.language, "AUTO");
    assert.deepEqual(settings.preferredVariants, []);
});

/**
 * The reading taken where the contract could be read both ways.
 *
 * The rule is applied to the language that will be sent, not to the raw value,
 * because a language that fell back to "auto" is sent as "auto" and the server
 * has no reason to refuse the variants that come with it. Dropping them there
 * would lose one setting to a mistake in another.
 */
for (const [label, language] of [...NOT_STRINGS, ...BLANKS]) {
    test(`a language that is ${label} falls back to auto and keeps the variants`, () => {
        const settings = normalize({
            ...GOOD,
            language,
            preferredVariants: ["fr-FR", "en-US"],
        });

        assert.equal(settings.language, "auto");
        assert.deepEqual(settings.preferredVariants, ["fr-FR", "en-US"]);
    });
}

test("normalize does not touch what it is given", () => {
    const raw = {
        url: "  https://lt.example/v2//  ",
        language: " auto ",
        motherTongue: " fr ",
        preferredVariants: [" fr-FR ", "fr-FR", ""],
        picky: "true",
    };
    const before = structuredClone(raw);

    normalize(raw);

    assert.deepEqual(raw, before);
});

test("normalize hands out a fresh list, not the one it was given", () => {
    // The options page keeps writing into its own object, and a shared list
    // would carry those later edits into what was already stored.
    const preferredVariants = ["fr-FR"];

    const settings = normalize({ ...GOOD, preferredVariants });

    assert.notStrictEqual(settings.preferredVariants, preferredVariants);
    assert.deepEqual(settings.preferredVariants, ["fr-FR"]);
});

test("two calls on the same input give equal but separate results", () => {
    const first = normalize(GOOD);
    const second = normalize(GOOD);

    assert.deepEqual(first, second);
    assert.notStrictEqual(first, second);
    assert.notStrictEqual(first.preferredVariants, second.preferredVariants);
});

for (const [label, raw] of [
    ["complete settings", GOOD],
    ["nothing", undefined],
    ["null", null],
    ["an empty object", {}],
    ["a number", 42],
    ["a string", "https://lt.example/v2"],
    ["a boolean", true],
    ["an array", []],
    ["a function", () => "https://lt.example/v2"],
    ["every field wrong", { url: 1, language: 2, motherTongue: 3, preferredVariants: 4, picky: 5 }],
]) {
    test(`normalize of ${label} gives the five keys and nothing else`, () => {
        const settings = normalize(raw);

        assert.equal(typeof settings, "object");
        assert.notEqual(settings, null);
        assert.deepEqual(Object.keys(settings).sort(), SETTINGS_KEYS);
    });
}

test("an unknown field is not carried over", () => {
    // The credentials are deliberately out of this round, and a settings object
    // that forwards whatever it was handed would store them the day one appears.
    const settings = normalize({
        ...GOOD,
        username: "someone@example.org",
        apiKey: "a-key",
        timeoutMs: 5000,
    });

    assert.deepEqual(Object.keys(settings).sort(), SETTINGS_KEYS);
    assert.equal(settings.username, undefined);
    assert.equal(settings.apiKey, undefined);
});

test("normalize never throws, whatever it is handed", () => {
    const hostile = [
        undefined,
        null,
        0,
        1,
        Number.NaN,
        "",
        "settings",
        true,
        false,
        [],
        {},
        () => undefined,
        new Date(),
        new Map(),
        Symbol("settings"),
        { url: {}, language: [], motherTongue: 0, preferredVariants: "fr-FR", picky: "yes" },
        { preferredVariants: [Symbol("fr"), () => "fr"] },
    ];

    for (const raw of hostile) {
        const settings = normalize(raw);

        assert.deepEqual(Object.keys(settings).sort(), SETTINGS_KEYS, String(raw));
    }
});

test("settings that can be used raise no problem", () => {
    assert.deepEqual(problemsWith(normalize(GOOD)), []);
});

for (const [label, url] of [
    ["https and a path", "https://lt.example/v2"],
    ["https and no path", "https://lt.example"],
    ["http and a port", "http://localhost:8081/v2"],
    ["http on a plain host", "http://lt.example"],
    ["a query", "https://lt.example/v2?lang=fr"],
]) {
    test(`an address with ${label} raises no problem`, () => {
        assert.deepEqual(problemsWith(normalize({ ...GOOD, url })), []);
    });
}

/**
 * One fault, one sentence. An address is empty, or it does not parse, or its
 * scheme is one nothing can be fetched over, and a page telling someone their
 * address is both empty and unparsable helps nobody fix it.
 */
for (const [label, url] of [
    ["an address that is empty", ""],
    ["an address that is nothing but spaces", "   "],
    ["an address that does not parse", "not a url"],
    ["a host without a scheme", "lt.example/v2"],
    ["a host and a port without a scheme", "localhost:8081"],
    ["a scheme-relative address", "//lt.example/v2"],
    ["an ftp address", "ftp://lt.example/v2"],
    ["a file address", "file:///tmp"],
    ["a data address", "data:text/plain,hello"],
    ["a javascript address", "javascript:alert(1)"],
]) {
    test(`${label} is reported as one sentence`, () => {
        const problems = problemsWith(normalize({ ...GOOD, url }));

        assert.equal(problems.length, 1, JSON.stringify(problems));
        assert.equal(typeof problems[0], "string");
        // A sentence, not an error code: two words at the very least.
        assert.match(problems[0], /\S \S/);
    });
}

test("an empty address is the problem of an extension nobody configured", () => {
    // The state on first install, and the one the options page has to explain.
    const problems = problemsWith(DEFAULTS);

    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], /\S \S/);
});

test("nothing but the address is a problem", () => {
    // A language the server does not know is the server's business to answer,
    // not a reason to refuse to check at all.
    const problems = problemsWith({
        url: "https://lt.example/v2",
        language: "zz-ZZ",
        motherTongue: "zz-ZZ",
        preferredVariants: [],
        picky: false,
    });

    assert.deepEqual(problems, []);
});

test("problemsWith never throws, whatever it is handed", () => {
    const hostile = [
        undefined,
        null,
        0,
        "",
        "https://lt.example/v2",
        true,
        [],
        {},
        () => undefined,
        { url: 42 },
        { url: null },
        { url: {} },
        { url: ["https://lt.example/v2"] },
    ];

    for (const settings of hostile) {
        const problems = problemsWith(settings);

        assert.ok(Array.isArray(problems), String(settings));
        for (const problem of problems) {
            assert.equal(typeof problem, "string");
            assert.notEqual(problem, "");
        }
    }
});

for (const [label, url, expected] of [
    ["https and a path", "https://lt.example/v2", "https://lt.example/*"],
    ["https and no path", "https://lt.example", "https://lt.example/*"],
    ["https and one slash", "https://lt.example/", "https://lt.example/*"],
    ["http and a port", "http://localhost:8081/v2", "http://localhost/*"],
    ["https and a port", "https://lt.example:8443/v2", "https://lt.example/*"],
    ["a deep path", "http://lt.example:8080/lt/v2/check", "http://lt.example/*"],
    ["a query", "https://lt.example/v2?lang=fr", "https://lt.example/*"],
    ["a fragment", "https://lt.example/v2#top", "https://lt.example/*"],
    ["an upper case scheme and host", "HTTPS://LT.EXAMPLE/v2", "https://lt.example/*"],
]) {
    test(`originOf ${label} gives the host pattern`, () => {
        assert.equal(originOf(url), expected);
    });
}

test("originOf never lets a port into the pattern", () => {
    // A host match pattern has no port component, and one carrying a port is
    // refused, so a server on a port could never be granted its permission. A
    // pattern without one covers every port of that host, which is the access
    // being asked for anyway.
    assert.equal(originOf("https://lt.example:443/v2"), "https://lt.example/*");
    assert.equal(originOf("http://lt.example:80/v2"), "http://lt.example/*");
    assert.equal(originOf("http://localhost:8010/v2"), "http://localhost/*");
    assert.equal(originOf("https://lt.example:9999/v2"), "https://lt.example/*");
});

test("originOf keeps no credential out of the pattern", () => {
    // A permission is asked for in a dialog the user reads, and a password has
    // no business being displayed in it.
    assert.equal(originOf("https://user:secret@lt.example/v2"), "https://lt.example/*");
});

for (const [label, url] of [
    ["an empty string", ""],
    ["spaces only", "   "],
    ["junk", "not a url"],
    ["a host without a scheme", "lt.example/v2"],
    ["a relative path", "/v2"],
    ["a bare path", "v2/check"],
    ["a scheme-relative address", "//lt.example/v2"],
    ["an ftp address", "ftp://lt.example/v2"],
    ["a file address", "file:///tmp"],
    ["a data address", "data:text/plain,hello"],
    ["a javascript address", "javascript:alert(1)"],
    ["a host and a port without a scheme", "localhost:8081"],
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["a boolean", true],
    ["an object", {}],
    ["an empty array", []],
]) {
    test(`originOf ${label} gives null`, () => {
        assert.equal(originOf(url), null);
    });
}

test("originOf reads the address normalize stored", () => {
    const settings = normalize({ url: "  https://lt.example/v2/  " });

    assert.equal(originOf(settings.url), "https://lt.example/*");
});

test("originOf of the default address gives null, there is nothing to ask for", () => {
    assert.equal(originOf(DEFAULTS.url), null);
});

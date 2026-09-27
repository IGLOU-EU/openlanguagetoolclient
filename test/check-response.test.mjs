/** Normalization of real server responses. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../src/languagetool.js";
import { config, jsonReply, loadCase, stubFetch, textReply } from "./helpers.mjs";

test("faulty French text: normalized matches", async (t) => {
    const fixture = loadCase("fr-errors.json");
    stubFetch(t, jsonReply(fixture.body));

    const result = await check(fixture.text, config({ language: "fr" }));

    assert.equal(result.failure, null);
    assert.equal(result.matches.length, 2);

    const [typo, grammar] = result.matches;

    assert.equal(typo.offset, 15);
    assert.equal(typo.length, 4);
    assert.equal(typo.ruleId, "FR_SPELLING_RULE");
    assert.equal(typo.categoryId, "TYPOS");
    assert.equal(typo.message, "Faute de frappe possible trouvée.");
    assert.equal(typo.replacements[0], "café");
    assert.equal(fixture.text.slice(typo.offset, typo.offset + typo.length), "cafe");

    assert.equal(grammar.offset, 26);
    assert.equal(grammar.length, 6);
    assert.equal(grammar.ruleId, "R_VAVOIR_VINF");
    assert.equal(grammar.categoryId, "CAT_HOMONYMES_PARONYMES");
    assert.deepEqual(grammar.replacements, ["mangé"]);
    assert.equal(fixture.text.slice(grammar.offset, grammar.offset + grammar.length), "manger");
});

test("replacements are strings, not objects", async (t) => {
    const fixture = loadCase("fr-errors.json");
    stubFetch(t, jsonReply(fixture.body));

    const result = await check(fixture.text, config({ language: "fr" }));

    for (const match of result.matches) {
        assert.ok(match.replacements.length > 0);
        for (const replacement of match.replacements) {
            assert.equal(typeof replacement, "string");
        }
    }
});

test("a match carries only the contract fields", async (t) => {
    const fixture = loadCase("fr-errors.json");
    stubFetch(t, jsonReply(fixture.body));

    const result = await check(fixture.text, config({ language: "fr" }));

    assert.deepEqual(Object.keys(result.matches[0]).sort(), [
        "categoryId",
        "categoryName",
        "issueType",
        "length",
        "message",
        "offset",
        "replacements",
        "ruleId",
    ]);
});

test("text without errors: empty matches and null failure", async (t) => {
    const fixture = loadCase("fr-clean.json");
    stubFetch(t, jsonReply(fixture.body));

    const result = await check(fixture.text, config({ language: "fr" }));

    assert.deepEqual(result.matches, []);
    assert.equal(result.failure, null);
    assert.equal(result.detectedLanguage, "fr");
});

test("language=auto: the detected language is reported", async (t) => {
    const fixture = loadCase("auto-english.json");
    stubFetch(t, jsonReply(fixture.body));

    const result = await check(fixture.text, config({ language: "auto" }));

    assert.equal(result.detectedLanguage, "en-US");
    assert.equal(result.failure, null);
    assert.deepEqual(
        result.matches.map((match) => match.ruleId),
        ["EN_A_VS_AN", "MORFOLOGIK_RULE_EN_US"],
    );
});

test("forced language: detectedLanguage reports the detection, not the requested language", async (t) => {
    // The server always detects, even when the language is imposed.
    const fixture = loadCase("fr-forced-on-english.json");
    assert.equal(fixture.json.language.code, "fr");
    assert.equal(fixture.json.language.detectedLanguage.code, "en-US");

    stubFetch(t, jsonReply(fixture.body));

    const result = await check(fixture.text, config({ language: "fr" }));

    assert.equal(result.detectedLanguage, "en-US");
});

test("without a detectedLanguage block, the response language prevails", async (t) => {
    stubFetch(t, jsonReply({ language: { code: "fr" }, matches: [] }));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.equal(result.detectedLanguage, "fr");
    assert.equal(result.failure, null);
});

test("without any language block at all, detectedLanguage is null", async (t) => {
    stubFetch(t, jsonReply({ matches: [] }));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.equal(result.detectedLanguage, null);
    assert.equal(result.failure, null);
});

test("a successful result carries only the contract fields", async (t) => {
    stubFetch(t, jsonReply(loadCase("fr-errors.json").body));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.deepEqual(Object.keys(result).sort(), [
        "confidence",
        "detectedLanguage",
        "failure",
        "matches",
    ]);
});

test("the confidence of the detection is reported", async (t) => {
    const fixture = loadCase("fr-errors.json");
    stubFetch(t, jsonReply(fixture.body));

    const result = await check(fixture.text, config({ language: "fr" }));

    // Read back from the capture: the number the server itself gave is the only
    // one worth anything, and the caller decides from it whether the language
    // may be imposed on the requests that follow.
    assert.equal(result.confidence, fixture.json.language.detectedLanguage.confidence);
    assert.equal(result.confidence, 0.99);
});

test("a confidence short of certainty comes back as the server gave it", async (t) => {
    // Real capture, 0.891. Rounded either way it would cross the threshold the
    // caller compares against, and a short paragraph sits exactly there.
    const fixture = loadCase("fr-clean.json");
    stubFetch(t, jsonReply(fixture.body));

    const result = await check(fixture.text, config({ language: "fr" }));

    assert.equal(result.confidence, fixture.json.language.detectedLanguage.confidence);
    assert.equal(result.confidence, 0.891);
});

test("forced language: the confidence is the detection's, not the request's", async (t) => {
    const fixture = loadCase("fr-forced-on-english.json");
    stubFetch(t, jsonReply(fixture.body));

    const result = await check(fixture.text, config({ language: "fr" }));

    assert.equal(result.detectedLanguage, "en-US");
    assert.equal(result.confidence, 0.99);
});

test("a detection that carries no confidence gives null", async (t) => {
    stubFetch(t, jsonReply({
        language: { code: "fr", detectedLanguage: { code: "fr" } },
        matches: [],
    }));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.equal(result.detectedLanguage, "fr");
    assert.equal(result.confidence, null);
    assert.equal(result.failure, null);
});

test("without a detectedLanguage block, the confidence is null", async (t) => {
    // It is read at language.detectedLanguage.confidence and nowhere else: the
    // language the request asked for is no measurement of anything.
    stubFetch(t, jsonReply({ language: { code: "fr", confidence: 0.99 }, matches: [] }));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.equal(result.detectedLanguage, "fr");
    assert.equal(result.confidence, null);
    assert.equal(result.failure, null);
});

test("without any language block at all, the confidence is null", async (t) => {
    stubFetch(t, jsonReply({ matches: [] }));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.equal(result.detectedLanguage, null);
    assert.equal(result.confidence, null);
    assert.equal(result.failure, null);
});

test("a confidence of zero is kept, it is a measurement like any other", async (t) => {
    // Measured against the real server: 0.20 on six characters. A low score is
    // the very thing the caller watches for, so it must not read as a missing one.
    stubFetch(t, jsonReply({
        language: { code: "it", detectedLanguage: { code: "it", confidence: 0 } },
        matches: [],
    }));

    const result = await check("Il a manger.", config({ language: "auto" }));

    assert.equal(result.confidence, 0);
    assert.equal(result.detectedLanguage, "it");
});

for (const [label, confidence] of [
    ["a string", "0.99"],
    ["null", null],
    ["a boolean", true],
    ["an object", {}],
    ["an array", [0.99]],
    ["an empty string", ""],
]) {
    test(`a confidence that is not a number (${label}) gives null`, async (t) => {
        stubFetch(t, jsonReply({
            language: { code: "fr", detectedLanguage: { code: "fr", confidence } },
            matches: [],
        }));

        const result = await check("Bonjour.", config({ language: "fr" }));

        // A caller comparing it to a threshold must not read "0.99", true or an
        // empty string as a score. The rest of the response stays usable.
        assert.equal(result.confidence, null);
        assert.equal(result.detectedLanguage, "fr");
        assert.equal(result.failure, null);
    });
}

test("a confidence JSON spells as infinite gives null", async (t) => {
    // 1e400 parses to Infinity, which passes any threshold it is compared to
    // while measuring nothing.
    stubFetch(t, jsonReply(
        '{"language":{"code":"fr","detectedLanguage":{"code":"fr","confidence":1e400}},'
        + '"matches":[]}',
    ));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.equal(result.confidence, null);
    assert.equal(result.detectedLanguage, "fr");
    assert.equal(result.failure, null);
});

test("a match without replacement gives an empty array", async (t) => {
    stubFetch(t, jsonReply({
        language: { code: "fr" },
        matches: [{
            message: "Nothing to suggest.",
            offset: 3,
            length: 2,
            rule: { id: "SOME_RULE", category: { id: "MISC" } },
        }],
    }));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.deepEqual(result.matches[0].replacements, []);
    assert.equal(result.failure, null);
});

test("faulty French text: the kind of each mistake comes through", async (t) => {
    const fixture = loadCase("fr-errors.json");
    stubFetch(t, jsonReply(fixture.body));

    const result = await check(fixture.text, config({ language: "fr" }));

    const [typo, grammar] = result.matches;

    // Read back from the capture, then spelled out, because the two real values
    // are what the menu has to have a colour for. The second one is the reason
    // there is a default at all: the server calls a French agreement mistake
    // uncategorized, so a name nobody recognises is the ordinary case.
    assert.equal(typo.issueType, fixture.json.matches[0].rule.issueType);
    assert.equal(typo.issueType, "misspelling");
    assert.equal(grammar.issueType, fixture.json.matches[1].rule.issueType);
    assert.equal(grammar.issueType, "uncategorized");
});

test("issueType is the field that does not change with the language", async (t) => {
    // The French capture names its category CAT_HOMONYMES_PARONYMES, which only
    // a French rule set has, and its rule R_VAVOIR_VINF. issueType is the one
    // field spelled in the same words whatever the language, which is why the
    // colour of a mistake is keyed on it and not on categoryId.
    const fixture = loadCase("fr-errors.json");
    stubFetch(t, jsonReply(fixture.body));

    const result = await check(fixture.text, config({ language: "fr" }));

    const grammar = result.matches[1];

    assert.equal(grammar.ruleId, "R_VAVOIR_VINF");
    assert.equal(grammar.categoryId, "CAT_HOMONYMES_PARONYMES");
    assert.equal(grammar.issueType, "uncategorized");
});

for (const file of [
    "fr-errors.json",
    "auto-english.json",
    "emoji-offsets.json",
    "fr-forced-on-english.json",
]) {
    test(`every match of ${file} carries the issueType the server sent`, async (t) => {
        const fixture = loadCase(file);
        stubFetch(t, jsonReply(fixture.body));

        const result = await check(fixture.text, config(fixture.params));

        assert.equal(result.failure, null);
        assert.ok(result.matches.length > 0);
        assert.deepEqual(
            result.matches.map((match) => match.issueType),
            fixture.json.matches.map((match) => match.rule.issueType),
        );
        for (const match of result.matches) {
            // A real capture always names one, so an empty value here would mean
            // the field is read somewhere other than rule.issueType.
            assert.notEqual(match.issueType, "");
        }
    });
}

test("a rule with no issueType gives an empty string", async (t) => {
    // Not every rule set fills it in, and a missing field must not become the
    // string "undefined" on its way to a lookup table.
    stubFetch(t, jsonReply({
        language: { code: "fr" },
        matches: [{
            message: "Nothing to say about the kind.",
            offset: 3,
            length: 2,
            replacements: [{ value: "café" }],
            rule: { id: "SOME_RULE", category: { id: "MISC" } },
        }],
    }));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.equal(result.matches[0].issueType, "");
    assert.equal(result.matches[0].ruleId, "SOME_RULE");
    assert.equal(result.matches[0].categoryId, "MISC");
    assert.equal(result.failure, null);
});

test("a match with no rule block at all is still a usable match", async (t) => {
    // The offsets are what the underline is drawn from, and they are there. A
    // match with no rule says nothing about the kind, and that is not a reason
    // to lose the mistake.
    stubFetch(t, jsonReply({
        language: { code: "fr" },
        matches: [{
            message: "Something is wrong.",
            offset: 3,
            length: 2,
            replacements: [{ value: "café" }],
        }],
    }));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.equal(result.failure, null);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].issueType, "");
    assert.equal(result.matches[0].ruleId, "");
    assert.equal(result.matches[0].categoryId, "");
    assert.equal(result.matches[0].offset, 3);
    assert.deepEqual(result.matches[0].replacements, ["café"]);
});

for (const [label, issueType] of [
    ["a number", 42],
    ["null", null],
    ["a boolean", true],
    ["an object", { name: "misspelling" }],
    ["an array", ["misspelling"]],
    ["an empty object", {}],
]) {
    test(`an issueType that is not a string (${label}) gives an empty string`, async (t) => {
        // It is used to pick a colour from a table of five names, so anything but
        // a string has to read as a kind nobody named rather than travel on.
        stubFetch(t, jsonReply({
            language: { code: "fr" },
            matches: [{
                message: "Faute de frappe possible trouvée.",
                offset: 3,
                length: 2,
                replacements: [{ value: "café" }],
                rule: { id: "SOME_RULE", issueType, category: { id: "TYPOS" } },
            }],
        }));

        const result = await check("Bonjour.", config({ language: "fr" }));

        assert.equal(result.matches[0].issueType, "");
        // The rest of the match stays usable: one unreadable field is no reason
        // to drop a mistake the user can see underlined.
        assert.equal(result.matches[0].ruleId, "SOME_RULE");
        assert.equal(result.matches[0].categoryId, "TYPOS");
        assert.equal(result.failure, null);
    });
}

test("an issueType that is an empty string stays an empty string", async (t) => {
    stubFetch(t, jsonReply({
        language: { code: "fr" },
        matches: [{
            message: "Faute de frappe possible trouvée.",
            offset: 3,
            length: 2,
            rule: { id: "SOME_RULE", issueType: "", category: { id: "TYPOS" } },
        }],
    }));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.equal(result.matches[0].issueType, "");
    assert.equal(result.failure, null);
});

// The name the server gives the category of a mistake, which is neither the id
// of that category nor the kind of mistake. It comes back in the language the
// text was checked in, and it tells a typo from a homonym where an issue type
// folds both into one family, so it is at once finer than the word this client
// would write and already translated. What it is not is stable: only issueType is
// spelled the same whatever the language, which is why a colour stays keyed on
// that one and a name read for what a human is shown.

test("faulty French text: each category is named in the language of the check", async (t) => {
    const fixture = loadCase("fr-errors.json");
    stubFetch(t, jsonReply(fixture.body));

    const result = await check(fixture.text, config({ language: "fr" }));

    const [typo, grammar] = result.matches;

    // Read back from the capture rather than retyped, then spelled out for the
    // first one, because these are the very words a French user is shown and a
    // test that only compared the field to itself would agree with any field.
    assert.equal(typo.categoryName, fixture.json.matches[0].rule.category.name);
    assert.equal(typo.categoryName, "Faute de frappe possible");
    assert.equal(grammar.categoryName, fixture.json.matches[1].rule.category.name);
    // The French rule set writes the typographic apostrophe, U+2019. A name that
    // came back with the straight one would have been rebuilt on the way rather
    // than passed on as the server sent it.
    assert.ok(grammar.categoryName.startsWith("Confusion d\u2019homonymes"));
    assert.ok(!grammar.categoryName.includes("'"));
});

test("the same category id is named in the language the text was checked in", async (t) => {
    // Both captures flag a typo under the id TYPOS, and the server names that
    // same category in the language it checked. That is the whole reason the name
    // is worth reading: the id says nothing to whoever writes the message.
    const french = loadCase("fr-errors.json");
    const english = loadCase("auto-english.json");
    // A Response can only be read once, so the stub answers with a fresh one per
    // call, in the order the two checks are made.
    const bodies = [french.body, english.body];
    stubFetch(t, () => jsonReply(bodies.shift()));

    const inFrench = await check(french.text, config({ language: "fr" }));
    const inEnglish = await check(english.text, config({ language: "auto" }));

    const typoFr = inFrench.matches[0];
    const typoEn = inEnglish.matches[1];

    assert.equal(typoFr.categoryId, "TYPOS");
    assert.equal(typoEn.categoryId, typoFr.categoryId);
    assert.equal(typoFr.categoryName, "Faute de frappe possible");
    assert.equal(typoEn.categoryName, "Possible Typo");
});

for (const file of [
    "fr-errors.json",
    "auto-english.json",
    "emoji-offsets.json",
    "fr-forced-on-english.json",
]) {
    test(`every match of ${file} carries the category name the server sent`, async (t) => {
        const fixture = loadCase(file);
        stubFetch(t, jsonReply(fixture.body));

        const result = await check(fixture.text, config(fixture.params));

        assert.equal(result.failure, null);
        assert.ok(result.matches.length > 0);
        assert.deepEqual(
            result.matches.map((match) => match.categoryName),
            fixture.json.matches.map((match) => match.rule.category.name),
        );
        for (const match of result.matches) {
            // A real capture always names one, so an empty value here would mean
            // the field is read somewhere other than rule.category.name, and a
            // value equal to the id would mean it is read one level too high.
            assert.notEqual(match.categoryName, "");
            assert.notEqual(match.categoryName, match.categoryId);
        }
    });
}

test("a rule with no category at all gives an empty name", async (t) => {
    stubFetch(t, jsonReply({
        language: { code: "fr" },
        matches: [{
            message: "Nothing to say about the category.",
            offset: 3,
            length: 2,
            replacements: [{ value: "café" }],
            rule: { id: "SOME_RULE", issueType: "misspelling" },
        }],
    }));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.equal(result.matches[0].categoryName, "");
    assert.equal(result.matches[0].categoryId, "");
    // The rest of the match stays usable: a mistake the user can see underlined
    // is never dropped over a field nobody filled in.
    assert.equal(result.matches[0].issueType, "misspelling");
    assert.equal(result.failure, null);
});

test("a category with an id but no name gives an empty name", async (t) => {
    // The name is optional in the server's own answer, and a missing field must
    // not become the string "undefined" on a panel.
    stubFetch(t, jsonReply({
        language: { code: "fr" },
        matches: [{
            message: "Faute de frappe possible trouvée.",
            offset: 3,
            length: 2,
            replacements: [{ value: "café" }],
            rule: { id: "SOME_RULE", issueType: "misspelling", category: { id: "TYPOS" } },
        }],
    }));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.equal(result.matches[0].categoryName, "");
    assert.equal(result.matches[0].categoryId, "TYPOS");
    assert.equal(result.failure, null);
});

for (const [label, name] of [
    ["a number", 42],
    ["zero", 0],
    ["null", null],
    ["a boolean", true],
    ["an object", { name: "Concordances" }],
    ["an array", ["Concordances"]],
    ["an empty object", {}],
]) {
    test(`a category name that is not a string (${label}) gives an empty string`, async (t) => {
        // It is shown to a human as it is, so anything but a string has to read
        // as a category nobody named rather than travel on to a panel.
        stubFetch(t, jsonReply({
            language: { code: "fr" },
            matches: [{
                message: "Faute de frappe possible trouvée.",
                offset: 3,
                length: 2,
                replacements: [{ value: "café" }],
                rule: {
                    id: "SOME_RULE",
                    issueType: "misspelling",
                    category: { id: "TYPOS", name },
                },
            }],
        }));

        const result = await check("Bonjour.", config({ language: "fr" }));

        assert.equal(result.matches[0].categoryName, "");
        assert.equal(result.matches[0].categoryId, "TYPOS");
        assert.equal(result.matches[0].issueType, "misspelling");
        assert.equal(result.failure, null);
    });
}

test("a category name that is an empty string stays an empty string", async (t) => {
    stubFetch(t, jsonReply({
        language: { code: "fr" },
        matches: [{
            message: "Faute de frappe possible trouvée.",
            offset: 3,
            length: 2,
            rule: { id: "SOME_RULE", category: { id: "TYPOS", name: "" } },
        }],
    }));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.equal(result.matches[0].categoryName, "");
    assert.equal(result.failure, null);
});

test("a match with no rule block at all names no category", async (t) => {
    // The offsets are what the underline is drawn from, and they are there. A
    // match with no rule says nothing about the category, and that is not a
    // reason to lose the mistake.
    stubFetch(t, jsonReply({
        language: { code: "fr" },
        matches: [{
            message: "Something is wrong.",
            offset: 3,
            length: 2,
            replacements: [{ value: "café" }],
        }],
    }));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].categoryName, "");
    assert.equal(result.matches[0].categoryId, "");
    assert.equal(result.matches[0].issueType, "");
    assert.equal(result.failure, null);
});

test("a failure carries no match, hence no category name anywhere", async (t) => {
    // The new field belongs to a match and to nothing else: on the result itself
    // it would be a fifth key the caller never asked for.
    stubFetch(t, jsonReply({ language: { code: "fr" }, matches: "not a list" }));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.deepEqual(result.matches, []);
    assert.equal(result.failure.kind, "malformed");
    assert.ok(!("categoryName" in result));
});

test("a failure result still carries only the contract fields", async (t) => {
    // A new field on a match must not appear on the result itself, and must not
    // take the place of one that is there. The caller reads `failure` first and
    // `matches` after it, whatever went wrong.
    stubFetch(t, jsonReply("not JSON at all"));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.deepEqual(Object.keys(result).sort(), [
        "confidence",
        "detectedLanguage",
        "failure",
        "matches",
    ]);
    assert.deepEqual(result.matches, []);
    assert.equal(result.failure.kind, "malformed");
});

test("a refused response carries no match, hence no kind of mistake", async (t) => {
    stubFetch(t, textReply(loadCase("error-403-auth.txt").body, 403));

    const result = await check("Bonjour.", config({ language: "fr" }));

    assert.deepEqual(Object.keys(result).sort(), [
        "confidence",
        "detectedLanguage",
        "failure",
        "matches",
    ]);
    assert.deepEqual(result.matches, []);
    assert.equal(result.failure.kind, "auth");
});

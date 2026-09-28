/**
 * Loader, fake DOM and shared readers for the compose side of the extension.
 *
 * A compose script is not a module: Thunderbird injects it into the page being
 * written, so it has no export and a test cannot import it. Each one is
 * therefore read and evaluated with `node:vm`, in a context holding the only
 * globals it is allowed to touch, and what it publishes on `globalThis` is
 * handed back from here.
 *
 * The fake nodes carry nothing but what `flatten` and `isSkipped` read. A real
 * DOM would mean a dependency, and the code under test is pure.
 *
 * The fixtures and the realm readers live here too, because the flattening, the
 * block cache and the chunking are tested in three files that all need the
 * same ones.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

import { srcDir } from "./helpers.mjs";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Evaluates one compose script in a context of its own and hands back what it
 * published there.
 *
 * @param {string} file Name of the script under `src/`.
 * @param {string} name The one global it is allowed to publish.
 * @param {object} provided What the page gives that script, and nothing more.
 * @returns {{api: object, publishedGlobals: string[]}} `publishedGlobals` lists
 * every name the script added, `name` included: Thunderbird gives every compose
 * script of one extension the same global, so a second name is a collision that
 * kills a sibling script.
 */
function loadComposeScript(file, name, provided = {}) {
    const sourcePath = join(srcDir, file);

    let source;
    try {
        source = readFileSync(sourcePath, "utf8");
    } catch (error) {
        // Expected until the script exists: say which file is missing rather
        // than let an ENOENT stack stand for the answer.
        if (error.code === "ENOENT") {
            throw new Error(`compose script missing, nothing to test yet: ${sourcePath}`);
        }
        throw error;
    }

    const sandbox = { ...provided };
    const given = new Set(Object.keys(sandbox));
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: sourcePath });

    if (sandbox[name] === undefined) {
        throw new Error(`${sourcePath} published no ${name} on globalThis`);
    }

    return {
        api: sandbox[name],
        publishedGlobals: Object.keys(sandbox).filter((key) => !given.has(key)),
    };
}

const bodyText = loadComposeScript("compose/body-text.js", "olcBody", {
    Node: { ELEMENT_NODE, TEXT_NODE },
});

/** The API the compose script publishes, as `src/compose/body-text.js` declares it. */
export const olcBody = bodyText.api;

/**
 * What `src/compose/body-text.js` added to the global object, `olcBody` included.
 *
 * Thunderbird gives every compose script of one extension the same global, so
 * anything else published there collides with `compose.js`.
 */
export const publishedGlobals = bodyText.publishedGlobals;

/**
 * Loads `src/compose/scheduler.js` and hands back its API and its published names.
 *
 * On demand rather than at import time, because the text tests share this file
 * and need nothing of the scheduler: a scheduler that is missing or that throws
 * on load must fail its own tests and no others.
 */
export const loadScheduler = () => loadComposeScript("compose/scheduler.js", "olcSchedule", {
    // What the page holds, minus the timers: those are injected into
    // createScheduler so the test owns the clock, and leaving them out of the
    // realm is what proves no real one is reached for behind its back.
    console,
    queueMicrotask,
});

/**
 * Loads `src/compose/panel.js` and hands back its API and its published names.
 *
 * On demand for the same reason as the scheduler, and with no `document` in the
 * realm on purpose: the panel's placement is arithmetic on four boxes of
 * numbers, so a script that reached for a DOM to work out where it goes would
 * fail here instead of only in a window nobody can unit test.
 */
export const loadPanel = () => loadComposeScript("compose/panel.js", "olcPanel", { console });

/** Fake text node. */
export function text(value) {
    return { nodeType: TEXT_NODE, nodeName: "#text", nodeValue: value, childNodes: [] };
}

/**
 * Fake element.
 *
 * @param {string} name Tag name, upper cased as `nodeName` reports it.
 * @param {{classes?: string[], attrs?: Object<string, string>}} options
 * @param {...object} children
 */
export function el(name, options = {}, ...children) {
    const classes = options.classes ?? [];
    const attrs = options.attrs ?? {};
    return {
        nodeType: ELEMENT_NODE,
        nodeName: name.toUpperCase(),
        childNodes: children,
        classList: { contains: (candidate) => classes.includes(candidate) },
        getAttribute: (attribute) => (attribute in attrs ? attrs[attribute] : null),
    };
}

/**
 * Fake element stripped of `classList` and `getAttribute`.
 *
 * The contract says `isSkipped` survives such a node, so a test needs one.
 */
export function bareEl(name, ...children) {
    return { nodeType: ELEMENT_NODE, nodeName: name.toUpperCase(), childNodes: children };
}

/**
 * A block as `splitBlocks` returns it.
 *
 * Written here rather than taken from the split, so that a cache or chunking
 * test proves its own function and not the split.
 */
export const block = (content, start = 0) => ({ text: content, start });

/** A match as `src/languagetool.js` normalizes it, with a block relative offset. */
export const match = (offset, length, message = "Possible typo") => ({
    offset,
    length,
    message,
    replacements: ["fixed"],
    ruleId: "MORFOLOGIK_RULE",
    categoryId: "TYPOS",
});

// The API under test lives in this loader's vm realm, so the arrays, objects and
// maps it builds never match the prototypes a strict deep equality compares.
// These read the values back into host ones.

export const blocksOf = (blocks) =>
    Array.from(blocks, (found) => ({ text: found.text, start: found.start }));

export const textsOf = (texts) => Array.from(texts);

export const matchOf = (found) => ({
    offset: found.offset,
    length: found.length,
    message: found.message,
    replacements: [...found.replacements],
    ruleId: found.ruleId,
    categoryId: found.categoryId,
});

export const matchesOf = (matches) => Array.from(matches, matchOf);

export const keysOf = (cache) => Array.from(cache.keys());

/**
 * Both edges of a shifted match must still land inside the node that holds the
 * error, at the expected place in that node.
 *
 * This is the property the whole shift rests on, and the first one an offset off
 * by one breaks.
 */
export function assertSpans(sent, found, node, from, to) {
    const start = olcBody.locate(sent.segments, found.offset, "start");
    const end = olcBody.locate(sent.segments, found.offset + found.length, "end");
    assert.ok(start, "a shifted match must still start inside a node");
    assert.ok(end, "a shifted match must still end inside a node");
    assert.equal(start.node, node);
    assert.equal(end.node, node);
    assert.equal(start.offset, from);
    assert.equal(end.offset, to);
    assert.equal(
        sent.text.slice(found.offset, found.offset + found.length),
        node.nodeValue.slice(from, to),
    );
}

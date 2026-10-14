/**
 * The contract of src/manifest.json: every path it names is a file that ships,
 * the compose scripts end with the one allowed to declare at top level, every
 * keyboard shortcut it declares is answered and can be rebound, and the add-on
 * manager points to the source.
 *
 * Nothing at runtime reports a path that resolves to nothing. A wrong entry in
 * `compose_scripts` leaves the compose side silent, with no underline and no
 * error anywhere, and a wrong icon draws the engine's torn page. The paths are
 * walked out of the file itself and never listed here, so a key added to the
 * manifest later is covered without anyone remembering this file.
 *
 * A shortcut fails the same way: a command fires under the name the manifest
 * gives it, JSON imports no module, so that name is spelled in the event page
 * too. Spelled differently in one of the two, the key does nothing at all and
 * says so nowhere. The two copies are held equal here for want of a build step to
 * derive one from the other. Two commands asking for the same combination fail as
 * quietly, one of them never firing.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";

import { srcDir } from "./helpers.mjs";

const manifest = JSON.parse(readFileSync(join(srcDir, "manifest.json"), "utf8"));

/**
 * Whether one string of the manifest names a file packaged with the extension.
 *
 * A manifest holds strings that are not paths, so they are told apart by the
 * form a packaged path has: a strict relative URL ending in a file extension.
 * A colon belongs to a host permission, an asterisk to a match pattern, and an
 * at sign to the extension id, whose `.eu` would otherwise read as one.
 */
const isPackagedPath = (value) =>
    typeof value === "string" && !/[:*@]/.test(value) && /\.[a-z0-9]{2,4}$/.test(value);

/**
 * Every packaged path the manifest names, wherever in the tree it sits.
 *
 * The keys are walked and not named, `icons` included, whose own keys are the
 * sizes and not the files.
 */
function pathsIn(node) {
    if (isPackagedPath(node)) {
        return [node];
    }
    if (Array.isArray(node)) {
        return node.flatMap(pathsIn);
    }
    if (node !== null && typeof node === "object") {
        return Object.values(node).flatMap(pathsIn);
    }
    return [];
}

test("every path the manifest names is a file the extension ships", () => {
    const paths = pathsIn(manifest);

    // A walk that stopped recognising a path would pass this test by finding
    // none at all, which is the one way it could lie.
    assert.notEqual(paths.length, 0, "no packaged path recognised in the manifest");

    for (const path of paths) {
        assert.ok(existsSync(join(srcDir, path)), `no packaged file named ${path}`);
    }
});

test("every shortcut the manifest declares is answered by the event page", () => {
    const source = readFileSync(join(srcDir, "background/background.js"), "utf8");

    for (const name of Object.keys(manifest.commands ?? {})) {
        assert.ok(source.includes(`"${name}"`), `no listener answers to ${name}`);
    }
});

test("every shortcut the manifest declares asks for a combination of its own", () => {
    // A command with no combination is a feature nothing reaches until somebody
    // binds it by hand, and two commands asking for the same one are two keys
    // appended to the same keyset, of which only one ever fires
    // (`ExtensionShortcuts.sys.mjs`, `registerKeysToDocument`, which builds a key
    // element per command and compares none of them).
    const claimed = new Map();

    for (const [name, command] of Object.entries(manifest.commands ?? {})) {
        const combination = command.suggested_key?.default;
        assert.equal(typeof combination, "string", name);
        assert.notEqual(combination, "", name);
        assert.equal(
            claimed.get(combination),
            undefined,
            `${name} asks for the combination of ${claimed.get(combination)}`,
        );
        claimed.set(combination, name);
    }
});

test("every shortcut the manifest declares can be found and changed", () => {
    // The add-on manager lists a command under its description, and the one that
    // carries none is a key nobody can discover or rebind: the description and
    // the suggested combination are all a command holds
    // (`schemas/commands.json`, CommandsShortcut).
    for (const [name, command] of Object.entries(manifest.commands ?? {})) {
        assert.equal(typeof command.description, "string", name);
        assert.notEqual(command.description, "", name);
    }
});

test("the add-on manager links to the source", () => {
    // Anyone who installs the extension can read what it does with their mail
    // before trusting it. The address itself lives in the manifest alone.
    const url = new URL(manifest.homepage_url);
    assert.equal(url.protocol, "https:", manifest.homepage_url);
});

test("the compose scripts are loaded with compose.js last", () => {
    // They share one global scope and compose.js is the only one allowed to
    // declare at top level, so a sibling loaded after it collides and takes the
    // whole compose side down with no trace but an opaque exception.
    for (const entry of manifest.compose_scripts) {
        assert.equal(basename(entry.js.at(-1)), "compose.js", entry.js.join(", "));
    }
});

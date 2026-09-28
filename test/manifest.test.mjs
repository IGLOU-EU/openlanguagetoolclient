/**
 * The contract of src/manifest.json: every path it names is a file that ships,
 * and the compose scripts end with the one allowed to declare at top level.
 *
 * Nothing at runtime reports a path that resolves to nothing. A wrong entry in
 * `compose_scripts` leaves the compose side silent, with no underline and no
 * error anywhere, and a wrong icon draws the engine's torn page. The paths are
 * walked out of the file itself and never listed here, so a key added to the
 * manifest later is covered without anyone remembering this file.
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

test("the compose scripts are loaded with compose.js last", () => {
    // They share one global scope and compose.js is the only one allowed to
    // declare at top level, so a sibling loaded after it collides and takes the
    // whole compose side down with no trace but an opaque exception.
    for (const entry of manifest.compose_scripts) {
        assert.equal(basename(entry.js.at(-1)), "compose.js", entry.js.join(", "));
    }
});

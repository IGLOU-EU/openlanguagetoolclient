/**
 * The contract between package.json and .gitlab-ci.yml: the pipeline runs the
 * oldest Node the project claims to support.
 *
 * The two copies are held equal here for want of a way for a GitLab image to
 * read package.json. Raised in one place alone, the floor turns into a claim
 * nothing checks: the suite then passes on a Node newer than the one a user
 * runs, and an API missing from the floor is found by that user and never by
 * the pipeline.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(root, name), "utf8");

test("the pipeline runs the Node version package.json declares as the floor", () => {
    const floor = JSON.parse(read("package.json")).engines.node;
    const wanted = floor.match(/(\d+)/)?.[1];
    assert.ok(wanted, `no version to read in engines.node: ${floor}`);

    const image = read(".gitlab-ci.yml").match(/^\s*image:\s*node:(\d+)/m);
    assert.ok(image, "no Node image declared in the pipeline");
    assert.equal(image[1], wanted, `the pipeline runs Node ${image[1]}, the floor is ${floor}`);
});

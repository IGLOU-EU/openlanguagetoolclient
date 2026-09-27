/**
 * Regenerates the fixtures from a real LanguageTool server.
 *
 * The tests replay real responses: a made-up response proves nothing about
 * the server's behavior. `cases.json` is the single source of truth for the
 * texts and the parameters, it serves here as much as in the tests.
 *
 * The flag is explicit because the script overwrites the fixtures, and
 * because `node --test` pointed at test/ imports everything that lives under
 * it.
 *
 *   node test/fixtures/capture.mjs --capture
 *   LT_SERVER=https://other.example/v2 node test/fixtures/capture.mjs --capture
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--capture")) {
    console.log("nothing done: run again with --capture to overwrite the fixtures");
    process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "cases.json"), "utf8"));
const server = process.env.LT_SERVER ?? manifest.server;

// The development server's certificate comes from a private authority.
const insecure = process.env.LT_INSECURE !== "0";

let failed = 0;

for (const testCase of manifest.cases) {
    const expected = testCase.status ?? 200;
    const args = ["--silent", "--show-error", "--max-time", "30", "--write-out", "\n%{http_code}"];
    if (insecure) {
        args.push("--insecure");
    }
    args.push("--request", "POST", `${server}/check`);
    args.push("--data-urlencode", `text=${testCase.text}`);
    for (const [name, value] of Object.entries(testCase.params)) {
        args.push("--data-urlencode", `${name}=${value}`);
    }

    const raw = execFileSync("curl", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    const split = raw.lastIndexOf("\n");
    const body = raw.slice(0, split);
    const status = Number(raw.slice(split + 1));

    if (status !== expected) {
        console.error(`FAIL ${testCase.file}: HTTP ${status} instead of ${expected}`);
        failed += 1;
        continue;
    }

    const content = testCase.file.endsWith(".json")
        ? `${JSON.stringify(JSON.parse(body), null, 2)}\n`
        : `${body.trim()}\n`;
    writeFileSync(join(here, testCase.file), content);
    console.log(`OK ${testCase.file} (HTTP ${status}, ${content.length} characters)`);
}

process.exitCode = failed === 0 ? 0 : 1;

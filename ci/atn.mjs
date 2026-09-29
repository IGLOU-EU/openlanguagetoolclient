/**
 * Publishes a version on addons.thunderbird.net, the only place a Thunderbird
 * extension is distributed from.
 *
 *   node ci/atn.mjs openlanguagetoolclient-1.2.3.xpi
 *
 * ATN is not addons.mozilla.org: the two split in 2018 and AMO takes no
 * Thunderbird add-on any more. ATN runs an older addons-server, whose API is
 * the v4, so the AMO recipes and their /api/v5/addons/upload/ endpoint answer
 * 404 here. `web-ext sign` speaks the v5 only since its version 8 and can no
 * longer be pointed elsewhere, and `sign-addon` reports a failure on success
 * because it waits for a signature ATN never produces: Thunderbird does not
 * require one and the project has no signing server. Hence this file, which
 * owes nothing to anyone and asks for no dependency.
 *
 * The credentials are the pair generated at
 * https://addons.thunderbird.net/en-US/developers/addon/api/key/ and read from
 * ATN_API_KEY and ATN_API_SECRET.
 *
 * The API takes a version and nothing else: the listing, the licence, the
 * screenshots and the release notes are typed on the site, and an add-on it has
 * never seen is created unlisted, which is why the listing exists before the
 * pipeline ever runs.
 */

import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const api = "https://addons.thunderbird.net/api/v4";

// The server refuses a token that outlives five minutes. Staying below leaves
// room for a runner whose clock drifts from its own.
const lifetime = 240;

/** How long the validation is watched, and how often. */
const maxTries = 12;
const delay = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const segment = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Where a given version lives, for the upload as for the watch. */
const versionUrl = (id, version) =>
    `${api}/addons/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/`;

/**
 * A JWT for one single request.
 *
 * The server keeps the nonces it has seen and refuses a replayed one, so a
 * token is never held for the next call.
 *
 * @param {string} key The API key, of the form user:543210:23.
 * @param {string} secret Its secret.
 */
export function token(key, secret) {
    // An unset CI/CD variable arrives as an empty string, and an empty secret
    // signs a token the server answers 401 to, which reads like a revoked key.
    if (!key) {
        throw new Error("no ATN API key: set the ATN_API_KEY variable");
    }
    if (!secret) {
        throw new Error("no ATN API secret: set the ATN_API_SECRET variable");
    }

    const issued = Math.floor(Date.now() / 1000);
    const header = segment({ alg: "HS256", typ: "JWT" });
    const payload = segment({ iss: key, jti: randomUUID(), iat: issued, exp: issued + lifetime });
    const signature = createHmac("sha256", secret)
        .update(`${header}.${payload}`)
        .digest("base64url");

    return `${header}.${payload}.${signature}`;
}

/** What the server answered, whatever shape it came in. */
async function detail(response) {
    const body = await response.text().catch(() => "");
    return body.trim().slice(0, 500);
}

/** The refusals worth a sentence of their own, the status alone saying nothing. */
const refusals = {
    401: "ATN refused the key or the secret",
    403: "this API key does not own the add-on",
    409: "this version is already published on ATN",
};

/**
 * Offers a package as a new version of the add-on.
 *
 * @param {{id: string, version: string, bytes: Buffer, name: string,
 *          key: string, secret: string}} release
 */
export async function upload({ id, version, bytes, name, key, secret }) {
    const form = new FormData();
    // The server reads the archive's kind from the name it is given.
    form.append("upload", new Blob([bytes], { type: "application/x-xpinstall" }), name);
    form.append("channel", "listed");

    const response = await fetch(versionUrl(id, version), {
        method: "PUT",
        headers: { Authorization: `JWT ${token(key, secret)}` },
        body: form,
    });

    // 201 says the id had never been seen, so ATN just created the add-on as
    // unlisted: nobody can install it and the listing is empty. Reported as a
    // success, the pipeline would announce a release no user can reach.
    if (response.status === 201) {
        throw new Error(
            `ATN knew no add-on under ${id} and created one, unlisted. ` +
            "Check the id, and create the listing on the site before publishing.",
        );
    }
    if (response.status !== 202) {
        const reason = refusals[response.status] ?? "ATN refused the version";
        throw new Error(`${reason} (HTTP ${response.status}): ${await detail(response)}`);
    }
}

/**
 * Watches the validation the server runs once the version is accepted.
 *
 * The upload answers before the archive is opened, so this is the only place a
 * package the validator throws away ever shows up.
 *
 * @returns {Promise<{processed: boolean, valid?: boolean}>} Still running when
 *          `processed` is false, which is not a failure: the version is there.
 */
export async function follow({ id, version, key, secret, pause = sleep, tries = maxTries }) {
    for (let attempt = 1; attempt <= tries; attempt += 1) {
        const response = await fetch(versionUrl(id, version), {
            method: "GET",
            headers: { Authorization: `JWT ${token(key, secret)}` },
        });
        if (!response.ok) {
            throw new Error(
                `ATN stopped answering during the validation (HTTP ${response.status}): ` +
                `${await detail(response)}`,
            );
        }

        const state = await response.json();
        if (state.processed) {
            if (!state.valid) {
                const messages = (state.validation_results?.messages ?? [])
                    .map((entry) => entry.message)
                    .join("; ");
                throw new Error(
                    `ATN rejected the package: ${messages || JSON.stringify(state.validation_results)}`,
                );
            }
            return { processed: true, valid: true };
        }

        if (attempt < tries) {
            await pause(delay);
        }
    }

    return { processed: false };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const path = process.argv[2];
    if (path === undefined) {
        console.error("usage: node ci/atn.mjs <package.xpi>");
        process.exit(2);
    }

    // The id and the version are the manifest's, never spelled again here.
    const manifest = JSON.parse(
        readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"),
    );
    const release = {
        id: manifest.browser_specific_settings.gecko.id,
        version: manifest.version,
        bytes: readFileSync(path),
        name: basename(path),
        key: process.env.ATN_API_KEY,
        secret: process.env.ATN_API_SECRET,
    };

    try {
        await upload(release);
        console.log(`${release.name} accepted by ATN, waiting for the validation`);

        const state = await follow(release);
        console.log(
            state.processed
                ? `version ${release.version} validated and listed`
                : `version ${release.version} uploaded, still being validated: ` +
                  "follow it on https://addons.thunderbird.net/developers/addons",
        );
    } catch (error) {
        // A stack trace says nothing to whoever opens a red pipeline.
        console.error(error.message);
        process.exit(1);
    }
}

/**
 * The contract of ci/atn.mjs, which is what the pipeline leans on to publish.
 *
 * A release is posted by a machine nobody watches, so every answer the server
 * can give is decided here rather than in front of a red pipeline. The three
 * that matter are the ones a green run would otherwise hide: a token the server
 * refuses, an add-on created instead of updated, and a version the validator
 * rejected after it was accepted for processing.
 *
 * The server is stubbed. Reaching the real one would publish something.
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { follow, token, upload } from "../ci/atn.mjs";
import { jsonReply, stubFetch } from "./helpers.mjs";

const credentials = { key: "user:543210:23", secret: "a-secret" };
const release = {
    id: "openlanguagetoolclient@iglou.eu",
    version: "1.2.3",
    bytes: Buffer.from("PK\u0003\u0004"),
    name: "openlanguagetoolclient-1.2.3.xpi",
    ...credentials,
};

/** The address the two calls share, with the id in the form a URL carries it. */
const endpoint =
    "https://addons.thunderbird.net/api/v4/addons/openlanguagetoolclient%40iglou.eu/versions/1.2.3/";

const decode = (segment) => JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));

test("the token names its algorithm and its issuer as the server expects", () => {
    const [header, payload] = token(credentials.key, credentials.secret).split(".");

    assert.deepEqual(decode(header), { alg: "HS256", typ: "JWT" });
    assert.equal(decode(payload).iss, credentials.key);
});

test("the token expires, and sooner than the five minutes the server allows", () => {
    const { iat, exp } = decode(token(credentials.key, credentials.secret).split(".")[1]);

    // Seconds since the epoch, not milliseconds: a token dated in milliseconds
    // is read as one issued in the year 56000 and refused, with a message that
    // says nothing about the unit.
    assert.ok(Math.abs(iat - Math.floor(Date.now() / 1000)) < 5, `iat out of range: ${iat}`);
    assert.ok(exp > iat, "the token never expires");
    assert.ok(exp - iat <= 300, `lifetime of ${exp - iat}s, the server refuses beyond 300`);
});

test("the token is signed with the secret", () => {
    const [header, payload, signature] = token(credentials.key, credentials.secret).split(".");

    const expected = createHmac("sha256", credentials.secret)
        .update(`${header}.${payload}`)
        .digest("base64url");
    assert.equal(signature, expected);
});

test("the token is spelled in the alphabet a URL and a header accept", () => {
    // Plain base64 carries +, / and =, which an Authorization header mangles.
    assert.match(token(credentials.key, credentials.secret), /^[\w-]+\.[\w-]+\.[\w-]+$/);
});

test("two tokens never carry the same nonce", () => {
    // The server refuses a replayed jti, so a nonce computed once would let the
    // first publication through and no other.
    const first = decode(token(credentials.key, credentials.secret).split(".")[1]);
    const second = decode(token(credentials.key, credentials.secret).split(".")[1]);

    assert.notEqual(first.jti, second.jti);
});

test("a missing key or secret stops the release before the network", () => {
    // An unset CI/CD variable arrives as an empty string, and an empty secret
    // signs a token the server answers 401 to, which reads like a revoked key.
    assert.throws(() => token("", credentials.secret), /key/i);
    assert.throws(() => token(credentials.key, ""), /secret/i);
    assert.throws(() => token(undefined, undefined), /key/i);
});

test("the version is offered to the address ATN publishes at", async (t) => {
    const calls = stubFetch(t, jsonReply({}, 202));

    await upload(release);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, endpoint);
    assert.equal(calls[0].options.method, "PUT");
    assert.match(calls[0].options.headers.Authorization, /^JWT [\w-]+\.[\w-]+\.[\w-]+$/);
});

test("the package is offered for the public listing, under a name ending in .xpi", async (t) => {
    // The server reads the archive's kind from the file name it is given, and
    // an unnamed part is stored as a blob it then refuses to unpack.
    const calls = stubFetch(t, jsonReply({}, 202));

    await upload(release);

    const form = calls[0].options.body;
    assert.equal(form.get("channel"), "listed");
    assert.equal(form.get("upload").name, release.name);
    assert.equal(form.get("upload").size, release.bytes.length);
});

test("an accepted version is reported as accepted", async (t) => {
    stubFetch(t, jsonReply({ processed: false }, 202));

    await assert.doesNotReject(() => upload(release));
});

test("an add-on created instead of updated is a failure, whatever the server says", async (t) => {
    // 201 means ATN had never seen this id, so it just created the add-on as
    // unlisted: nobody can install it and the listing has to be filled by hand.
    // Left as a success, the pipeline would report a release no user can reach.
    stubFetch(t, jsonReply({}, 201));

    await assert.rejects(() => upload(release), /unlisted|created/i);
});

test("a version already published is named as such", async (t) => {
    // Replaying a pipeline on the same tag lands here, and the bare status says
    // nothing about which side is at fault.
    stubFetch(t, jsonReply({ error: "Version already exists." }, 409));

    await assert.rejects(() => upload(release), /already/i);
});

test("a key that does not own the add-on is named as such", async (t) => {
    stubFetch(t, jsonReply({ detail: "You do not own this add-on." }, 403));

    await assert.rejects(() => upload(release), /own/i);
});

test("a refused token is named as such", async (t) => {
    stubFetch(t, jsonReply({ detail: "Authentication credentials were not provided." }, 401));

    await assert.rejects(() => upload(release), /authentication|401/i);
});

test("any other refusal carries what the server answered", async (t) => {
    // The validator's reason travels in the body, and a bare status number
    // sends whoever reads the pipeline looking through the logs of ATN.
    stubFetch(t, jsonReply({ error: "Manifest v3 requires a strict_min_version" }, 400));

    await assert.rejects(() => upload(release), /strict_min_version/);
});

test("the validation is watched until the server has processed the version", async (t) => {
    let answered = 0;
    const calls = stubFetch(t, () => {
        answered += 1;
        return jsonReply({ processed: answered >= 3, valid: true }, 200);
    });

    const result = await follow({ ...release, pause: async () => {} });

    assert.equal(result.processed, true);
    assert.equal(result.valid, true);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, endpoint);
    assert.equal(calls[0].options.method, "GET");
});

test("each poll carries a token of its own", async (t) => {
    // A token is good for one request: reused, the second call comes back 401
    // and the pipeline reports a failure that never happened.
    let answered = 0;
    const calls = stubFetch(t, () => {
        answered += 1;
        return jsonReply({ processed: answered >= 2, valid: true }, 200);
    });

    await follow({ ...release, pause: async () => {} });

    assert.notEqual(calls[0].options.headers.Authorization, calls[1].options.headers.Authorization);
});

test("a version the validator rejected fails the release, with its reasons", async (t) => {
    // The upload is accepted before the archive is validated, so this is the
    // only place a rejected package shows up. Silent, the pipeline would be
    // green over a version ATN threw away.
    stubFetch(t, jsonReply({
        processed: true,
        valid: false,
        validation_results: { messages: [{ message: "Unknown permission: messengerSettings" }] },
    }, 200));

    await assert.rejects(
        () => follow({ ...release, pause: async () => {} }),
        /messengerSettings/,
    );
});

test("a validation still running when time is up is reported, not failed", async (t) => {
    // The version is uploaded: failing here would ask for a new tag over a
    // release that is on its way. The pipeline says where to go and look.
    // A fresh answer each time: a Response only gives its body once.
    const calls = stubFetch(t, () => jsonReply({ processed: false }, 200));

    const result = await follow({ ...release, tries: 2, pause: async () => {} });

    assert.equal(calls.length, 2, "the watch did not stop when its tries ran out");

    assert.equal(result.processed, false);
});

test("a server that stops answering during the watch fails the release", async (t) => {
    stubFetch(t, jsonReply({ detail: "Service Unavailable" }, 503));

    await assert.rejects(() => follow({ ...release, pause: async () => {} }), /503|unavailable/i);
});

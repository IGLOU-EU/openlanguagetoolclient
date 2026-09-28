/**
 * LanguageTool server client.
 *
 * This module only talks to the server and normalizes its response. No
 * dependency, no Thunderbird API, no DOM access: it must stay testable
 * without a browser. The event page calls it, not the compose script, because
 * a compose script can neither import a module nor hold host permissions.
 *
 * @typedef {object} ServerConfig
 * @property {string}   url                  API root, for example "https://lt.example/v2".
 * @property {string}   [language]           Language code, or DETECT_LANGUAGE.
 * @property {string}   [motherTongue]
 * @property {string[]} [preferredVariants]
 * @property {boolean}  [picky]              Picky mode, sends level=picky.
 * @property {number}   [timeoutMs]          Timeout in milliseconds, 10,000 by default.
 *                                           Exceeding it is reported as an unreachable
 *                                           server, kind "unreachable".
 *
 * @typedef {object} Match
 * @property {number}   offset        In UTF-16 code units, hence indexable as is in a
 *                                    JavaScript string.
 * @property {number}   length
 * @property {string}   message
 * @property {string[]} replacements
 * @property {string}   ruleId
 * @property {string}   categoryId
 * @property {string}   categoryName  The kind of mistake as the server names it, in the
 *                                    language it checked, so it is both finer than
 *                                    `issueType` and already translated. Empty when the
 *                                    server says nothing usable.
 * @property {string}   issueType     The kind of mistake, and the one field that means
 *                                    the same thing whatever the language, where
 *                                    `categoryId` is named per language. Empty when the
 *                                    server says nothing usable.
 *
 * @typedef {object} Language
 * @property {string} name      As the server spells it, for example "English (US)".
 * @property {string} code      For example "en".
 * @property {string} longCode  For example "en-US". Equal to `code` unless the entry
 *                              is a variant of a language.
 *
 * @typedef {object} Failure
 * @property {"unreachable"|"auth"|"quota"|"malformed"} kind
 * @property {string} detail
 *
 * @typedef {object} CheckResult
 * @property {Match[]}      matches
 * @property {string|null}  detectedLanguage
 * @property {number|null}  confidence        How sure the server is of the language it
 *                                            detected, null when it reports no usable
 *                                            number. The caller decides from it whether
 *                                            the language may be imposed on later
 *                                            requests.
 * @property {Failure|null} failure
 */

import { DETECT_LANGUAGE, TRAILING_SLASHES } from "./settings.js";

/** Length kept for `detail`: the server may answer at great length. */
const DETAIL_LIMIT = 200;

/**
 * Default timeout, in milliseconds.
 *
 * Measured on the target server, a personal one on the local network: 25 ms
 * for an ordinary email, 292 ms at worst on a text of 10,000 characters. Ten
 * seconds therefore leave room for a cold start that loads the language
 * models, a virtual machine waking up or a slow link, while bounding a hung
 * connection that fetch would otherwise wait on forever.
 */
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Checks a text.
 *
 * Never throws. A failure is reported through `failure` and an empty
 * `matches`, because the extension must never prevent writing or sending.
 *
 * @param {string} text
 * @param {ServerConfig} config
 * @returns {Promise<CheckResult>}
 */
export async function check(text, config) {
    if (typeof text !== "string" || text.trim() === "") {
        return { matches: [], detectedLanguage: null, confidence: null, failure: null };
    }

    const settings = config ?? {};
    const timeoutMs = timeoutOf(settings);

    try {
        const response = await fetch(endpointOf(settings, "check"), {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: requestBody(text, settings),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const body = await response.text();
        if (!response.ok) {
            return failed(
                kindForStatus(response.status),
                `HTTP ${response.status} ${excerpt(body)}`,
            );
        }
        return normalizeCheck(body);
    } catch (error) {
        return failed("unreachable", networkDetail(error, timeoutMs));
    }
}

/**
 * The languages the server offers.
 *
 * Never throws either, for the same reason: the options page has to be able to
 * say that the server did not answer, not break on it.
 *
 * @param {ServerConfig} config Only `url` and `timeoutMs` are read.
 * @returns {Promise<{languages: Language[], failure: Failure|null}>} An entry
 * missing any of its three fields is dropped, because a menu cannot show a
 * language it cannot name or ask for.
 */
export async function languages(config) {
    const settings = config ?? {};
    const timeoutMs = timeoutOf(settings);

    try {
        const response = await fetch(endpointOf(settings, "languages"), {
            signal: AbortSignal.timeout(timeoutMs),
        });
        const body = await response.text();
        if (!response.ok) {
            return noLanguages(
                kindForStatus(response.status),
                `HTTP ${response.status} ${excerpt(body)}`,
            );
        }
        return normalizeLanguages(body);
    } catch (error) {
        return noLanguages("unreachable", networkDetail(error, timeoutMs));
    }
}

/**
 * An unusable value coming from the options must not doom every check. The
 * conversion covers an options page that stores the raw value of an input
 * field.
 */
function timeoutOf(config) {
    const configured = Number(config.timeoutMs);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

function endpointOf(config, path) {
    return `${String(config.url).replace(TRAILING_SLASHES, "")}/${path}`;
}

function requestBody(text, config) {
    const params = new URLSearchParams();
    const language = config.language || DETECT_LANGUAGE;

    params.set("text", text);
    params.set("language", language);

    if (config.motherTongue) {
        params.set("motherTongue", config.motherTongue);
    }
    // The server rejects the whole request with a 400 if preferredVariants
    // comes with an explicit language.
    if (language === DETECT_LANGUAGE && config.preferredVariants?.length) {
        params.set("preferredVariants", config.preferredVariants.join(","));
    }
    if (config.picky) {
        params.set("level", "picky");
    }

    return params;
}

function kindForStatus(status) {
    if (status === 429) {
        return "quota";
    }
    if (status === 401 || status === 403) {
        return "auth";
    }
    // A stopped instance behind a reverse proxy shows up as a 5xx, not as a
    // connection failure.
    if (status >= 500) {
        return "unreachable";
    }
    return "malformed";
}

function normalizeCheck(body) {
    let parsed;
    try {
        parsed = JSON.parse(body);
    } catch {
        return failed("malformed", `unreadable response: ${excerpt(body)}`);
    }

    const rawMatches = parsed?.matches;
    if (!Array.isArray(rawMatches)) {
        return failed("malformed", `matches field missing or invalid: ${excerpt(body)}`);
    }

    const matches = [];
    for (const match of rawMatches) {
        // offset and length carry the whole conversion into a Range: one
        // unusable value makes the whole response unusable.
        if (!Number.isFinite(match?.offset) || !Number.isFinite(match?.length)) {
            return failed(
                "malformed",
                `match without usable offset or length: ${excerpt(body)}`,
            );
        }
        matches.push({
            offset: match.offset,
            length: match.length,
            message: typeof match.message === "string" ? match.message : "",
            replacements: replacementsOf(match.replacements),
            ruleId: match.rule?.id ?? "",
            categoryId: match.rule?.category?.id ?? "",
            categoryName:
                typeof match.rule?.category?.name === "string" ? match.rule.category.name : "",
            issueType: typeof match.rule?.issueType === "string" ? match.rule.issueType : "",
        });
    }

    const confidence = parsed.language?.detectedLanguage?.confidence;

    return {
        matches,
        detectedLanguage:
            parsed.language?.detectedLanguage?.code ?? parsed.language?.code ?? null,
        // Anything but a number is no measure of anything, and a caller that
        // compares it to a threshold must not read a string as a low score.
        confidence: Number.isFinite(confidence) ? confidence : null,
        failure: null,
    };
}

function replacementsOf(replacements) {
    if (!Array.isArray(replacements)) {
        return [];
    }
    return replacements
        .map((replacement) => replacement?.value)
        .filter((value) => typeof value === "string");
}

function normalizeLanguages(body) {
    let parsed;
    try {
        parsed = JSON.parse(body);
    } catch {
        return noLanguages("malformed", `unreadable response: ${excerpt(body)}`);
    }

    if (!Array.isArray(parsed)) {
        return noLanguages("malformed", `expected a list of languages: ${excerpt(body)}`);
    }

    const kept = [];
    for (const entry of parsed) {
        const { name, code, longCode } = entry ?? {};
        if (typeof name === "string" && typeof code === "string" && typeof longCode === "string") {
            kept.push({ name, code, longCode });
        }
    }

    return { languages: kept, failure: null };
}

function noLanguages(kind, detail) {
    return { languages: [], failure: { kind, detail } };
}

function failed(kind, detail) {
    return {
        matches: [],
        detectedLanguage: null,
        confidence: null,
        failure: { kind, detail },
    };
}

/**
 * Every network failure is reported as "unreachable", but `detail` must keep
 * the diagnosis possible. Without it, a timeout, a refused certificate, a
 * silent DNS and a closed port would all give the same "TypeError: fetch
 * failed", which helps nobody fix their configuration.
 */
function networkDetail(error, timeoutMs) {
    if (error?.name === "TimeoutError") {
        return `timeout of ${timeoutMs} ms exceeded`;
    }
    const cause = error?.cause?.message;
    return cause ? `${error}: ${cause}` : String(error);
}

function excerpt(body) {
    return String(body).trim().slice(0, DETAIL_LIMIT);
}

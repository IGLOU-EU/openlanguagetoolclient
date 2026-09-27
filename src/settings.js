/**
 * The settings the options page writes and the event page reads.
 *
 * No Thunderbird API, no DOM, no network: both sides load it, and it must stay
 * provable under Node.
 *
 * @typedef {object} Settings
 * @property {string}   url               API root, with no trailing slash, "" when unset.
 * @property {string}   language          Language code, or "auto" for detection.
 * @property {string}   motherTongue      Empty when none is set.
 * @property {string[]} preferredVariants Empty unless the language is "auto".
 * @property {boolean}  picky             Picky mode.
 */

/** What an extension nobody has configured yet reads. */
export const DEFAULTS = {
    url: "",
    language: "auto",
    motherTongue: "",
    preferredVariants: [],
    picky: false,
};

/**
 * Turns whatever was stored into usable settings.
 *
 * Never throws and always returns the five fields, because what comes back from
 * `browser.storage.local` is whatever a half filled form, an older version or a
 * hand edited profile left there, and a check must not depend on it being
 * sound.
 *
 * @param {object} raw
 * @returns {Settings}
 */
export function normalize(raw) {
    const language = textOf(raw?.language) || DEFAULTS.language;
    return {
        url: textOf(raw?.url).replace(/\/+$/, ""),
        language,
        motherTongue: textOf(raw?.motherTongue),
        // The server answers HTTP 400 to preferred variants sent together with
        // an explicit language, and the check then returns nothing at all, so
        // that pair must not be representable.
        preferredVariants: language === "auto" ? listOf(raw?.preferredVariants) : [],
        picky: raw?.picky === true,
    };
}

/**
 * What keeps these settings from being usable, in sentences for the options
 * page to show.
 *
 * Only the address is judged, because it is the one field the extension cannot
 * do without. A language the server does not know comes back from it as an
 * ordinary failure, which the check already reports.
 *
 * @param {Settings} settings Normalized settings.
 * @returns {string[]} Empty when nothing is wrong. Never throws.
 */
export function problemsWith(settings) {
    const url = textOf(settings?.url);
    if (url === "") {
        return ["No server address. Enter the address of your LanguageTool server."];
    }

    const parsed = parsedUrl(url);
    if (parsed === null) {
        return [`"${url}" is not a valid address.`];
    }
    if (!isWebScheme(parsed)) {
        return ["The server address must start with http:// or https://."];
    }

    return [];
}

/**
 * The match pattern a host permission needs for that address.
 *
 * A host permission is granted for a whole host, so the path goes away, and so
 * does the port: a match pattern has no port component, and one carrying a port
 * is refused, which would leave every server on a port of its own out of reach.
 * Without it the pattern covers every port of that host, which is the access
 * being asked for anyway.
 *
 * @param {string} url
 * @returns {string|null} Null for an address that does not parse, and for one
 * of any scheme but http and https, which no host permission covers.
 */
export function originOf(url) {
    const parsed = parsedUrl(url);
    if (parsed === null || !isWebScheme(parsed)) {
        return null;
    }
    return `${parsed.protocol}//${parsed.hostname}/*`;
}

/** Anything that is not a string holds no setting. */
function textOf(value) {
    return typeof value === "string" ? value.trim() : "";
}

function listOf(values) {
    if (!Array.isArray(values)) {
        return [];
    }

    const kept = [];
    for (const value of values) {
        const text = textOf(value);
        if (text !== "" && !kept.includes(text)) {
            kept.push(text);
        }
    }
    return kept;
}

function parsedUrl(value) {
    try {
        return new URL(value);
    } catch {
        return null;
    }
}

function isWebScheme(url) {
    return url.protocol === "http:" || url.protocol === "https:";
}

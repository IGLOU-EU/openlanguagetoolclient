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
 * @property {string}   underline         One of UNDERLINES, the thickness of the mark.
 * @property {number}   idleSeconds       Quiet typing a check waits for, in seconds.
 */

/**
 * The thicknesses the underline can take, from the thinnest to the thickest.
 *
 * A closed list, because the mark is drawn by a stylesheet loaded once, which
 * has to carry a rule for every level named here.
 */
export const UNDERLINES = ["thin", "normal", "thick"];

/**
 * The range a wait may be set to, in seconds.
 *
 * Below the minimum a check would fire between two words, and above the maximum
 * a message would be sent long before it was ever checked.
 */
export const MIN_IDLE_SECONDS = 0.5;
export const MAX_IDLE_SECONDS = 60;

/** What an extension nobody has configured yet reads. */
export const DEFAULTS = {
    url: "",
    language: "auto",
    motherTongue: "",
    preferredVariants: [],
    picky: false,
    underline: "normal",
    // Seconds and not milliseconds: the stored value is the one the human typed,
    // so the only conversion in the extension is the one the compose side makes.
    //
    // The server is not what sets this default, it answers between 9 and 95
    // milliseconds on the measured sizes, so the rhythm of writing sets it
    // instead. Anything much shorter fires in the middle of a half typed word
    // and underlines it as a mistake, and a wait this long still reads as
    // pending rather than as dead, because the toolbar button says a check is
    // coming.
    idleSeconds: 1.5,
};

/**
 * Turns whatever was stored into usable settings.
 *
 * Never throws and always returns the seven fields, because what comes back from
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
        underline: levelOf(raw?.underline),
        idleSeconds: secondsOf(raw?.idleSeconds),
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

/** Anything the stylesheet has no rule for holds no thickness. */
function levelOf(value) {
    const level = textOf(value);
    return UNDERLINES.includes(level) ? level : DEFAULTS.underline;
}

/**
 * A wait out of range is brought back to the nearest bound rather than dropped,
 * because an older version and a hand edited profile still say which end was
 * wanted. Nothing is coerced: the options page turns its field into a number,
 * so a value that is no number here says nothing at all.
 */
function secondsOf(value) {
    if (!Number.isFinite(value)) {
        return DEFAULTS.idleSeconds;
    }
    return Math.min(Math.max(value, MIN_IDLE_SECONDS), MAX_IDLE_SECONDS);
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

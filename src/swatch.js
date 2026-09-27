/**
 * What says which kind of mistake something belongs to: a colour, and the name a
 * human reads for it.
 *
 * A menu item accepts an icon, and only as a PNG or JPEG `data:` URL: an SVG
 * `data:` URL and an `ImageData` are both refused by the schema
 * (`modules/Schemas.sys.mjs`, `imageDataOrStrictRelativeUrl`). Nothing else on a
 * menu item can carry a colour, since an extension cannot style one at all. So
 * the swatch is a one by one PNG, built here from the hexadecimal value, which
 * keeps the colours readable and editable in one place instead of frozen inside
 * base64 blobs or image files.
 *
 * No Thunderbird API and no DOM, like the rest of the event page's modules, so
 * the whole thing is provable under Node.
 */

/**
 * One colour per family of mistake.
 *
 * `other` is the wavy underline's own colour, which `src/compose.css` still
 * declares for itself: a stylesheet injected into the page being written cannot
 * read a module, so the two sides have no single value to share yet. The
 * families peel off from what the user already sees rather than renaming it.
 */
export const SWATCHES = {
    misspelling: "#c0392b",
    grammar: "#d35400",
    typographical: "#8e44ad",
    style: "#16a085",
    other: "#1c5fd6",
};

/**
 * What a human reads for each family.
 *
 * The issue types are the server's own vocabulary, in its own spelling, and a
 * panel has room for a word where `locale-violation` says nothing to anyone.
 */
const LABELS = {
    misspelling: "Spelling",
    grammar: "Grammar",
    typographical: "Typography",
    style: "Style",
    other: "Other",
};

/**
 * LanguageTool's issue types, grouped down to the five the menu shows.
 *
 * A `Map` rather than an object, because an unknown issue type must read as
 * nothing, and a plain object answers `constructor` or `toString` with
 * something inherited.
 */
const FAMILIES = new Map([
    ["misspelling", "misspelling"],
    ["grammar", "grammar"],
    ["typographical", "typographical"],
    ["whitespace", "typographical"],
    ["formatting", "typographical"],
    ["style", "style"],
    ["register", "style"],
    ["locale-violation", "style"],
]);

/**
 * Which family one issue type belongs to.
 *
 * @param {string} issueType As `src/languagetool.js` reports it. Anything the
 *        server did not name, up to a value that is no string at all, is
 *        `other`: the vocabulary is the server's and it grows with its rules.
 * @returns {string} One of the keys of `SWATCHES`.
 */
export function familyOf(issueType) {
    const kind = typeof issueType === "string" ? issueType.trim().toLowerCase() : "";
    return FAMILIES.get(kind) ?? "other";
}

/**
 * The colour of one issue type's family, and the name to read for the mistake.
 *
 * The panel lives in a compose script, which can import nothing, so the pair
 * travels with each match from the event page instead. That is what keeps the
 * colours in this one file rather than in a second copy on the compose side.
 *
 * The server names the category in the language it checked, and names it more
 * precisely than five families ever could, so that name is what a human reads.
 * The colour stays on the family, because a colour has to be coarse to be read
 * at a glance.
 *
 * @param {string} issueType As `src/languagetool.js` reports it.
 * @param {string} [categoryName] As `src/languagetool.js` reports it. Nothing
 *        usable there leaves the family's English name, which is all there is
 *        when the server said nothing.
 * @returns {{color: string, label: string}} The `other` family's colour for
 *          anything the server did not name, and it never throws, because
 *          `familyOf` answers a family for every value there is.
 */
export function paintFor(issueType, categoryName) {
    const family = familyOf(issueType);
    const named = typeof categoryName === "string" ? categoryName.trim() : "";
    return { color: SWATCHES[family], label: named === "" ? LABELS[family] : named };
}

/** Stands for one whitespace character, which a button would show as nothing. */
const SPACE = "␣";

/** Stands for a deletion with no visible covered text to show in its place. */
const NOTHING = "∅";

/** The whitespace at the ends of a replacement, which is the invisible part. */
const EDGES = /^\s+|\s+$/g;

/**
 * How one replacement is shown, and what it writes.
 *
 * A replacement that deletes has nothing to print, and one made of whitespace
 * prints nothing visible, so both would be a button with no face and a menu line
 * with no text. What such a replacement does is shown instead: the text it takes
 * away, struck through, or a mark per space. No word in any language, since the
 * panel is written in none and the mistake may be in any.
 *
 * @param {string} value The replacement the server offered.
 * @param {string} covered The text the mistake covers.
 * @returns {{value: string, text: string, struck: boolean}|null} `null` for
 *          anything that is no string, which the callers skip. Never throws, so
 *          a hostile replacement costs no right click and no panel.
 */
export function choiceFor(value, covered) {
    if (typeof value !== "string") {
        return null;
    }
    if (value === "") {
        // Whitespace struck through is still nothing to look at, so the covered
        // text stands for what goes only when something of it can be seen.
        const seen = typeof covered === "string" && covered.trim() !== "";
        return { value, text: seen ? covered : NOTHING, struck: true };
    }
    // Only the ends, so a replacement of several words keeps the spaces between
    // them as spaces.
    const text = value.replace(EDGES, (run) => SPACE.repeat(run.length));
    return { value, text, struck: false };
}

/** `#rrggbb` only, which is the one form `SWATCHES` is written in. */
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The five swatches are asked for again at every right click and never change,
 * so each colour is encoded the first time it is wanted and kept.
 */
const encoded = new Map();

/**
 * The icon for one colour, ready for `menus.create`.
 *
 * @param {string} color `#rrggbb`. Anything else gives the `other` swatch: a
 *        menu entry without its icon is a smaller loss than a right click that
 *        throws.
 * @returns {string} A `data:image/png;base64,` URL.
 */
export function swatchFor(color) {
    const known = typeof color === "string" && HEX.test(color);
    const usable = known ? color.toLowerCase() : SWATCHES.other;

    let url = encoded.get(usable);
    if (url === undefined) {
        url = `data:image/png;base64,${base64(png(usable))}`;
        encoded.set(usable, url);
    }
    return url;
}

/** Signature of every PNG file, from the specification's clause 5.2. */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * A one by one opaque PNG of one colour.
 *
 * Truecolour, 8 bits per channel, no interlacing, so the image data is the one
 * scanline's filter byte followed by the three components.
 */
function png(color) {
    const scanline = [
        0,
        parseInt(color.slice(1, 3), 16),
        parseInt(color.slice(3, 5), 16),
        parseInt(color.slice(5, 7), 16),
    ];

    const header = [...be32(1), ...be32(1), 8, 2, 0, 0, 0];
    return [
        ...SIGNATURE,
        ...chunk("IHDR", header),
        ...chunk("IDAT", deflate(scanline)),
        ...chunk("IEND", []),
    ];
}

/** Length, type, data, and the CRC of the type and data together. */
function chunk(type, data) {
    const body = [...type].map((character) => character.charCodeAt(0)).concat(data);
    return [...be32(data.length), ...body, ...be32(crc32(body))];
}

/**
 * The zlib stream a PNG's image data has to be.
 *
 * A stored block, which deflate allows and which every decoder must accept:
 * four bytes have nothing to compress, and a real compressor here would be a
 * hundred lines for no gain.
 */
function deflate(data) {
    const length = data.length;
    return [
        0x78,
        0x01,
        0x01,
        length & 0xff,
        (length >>> 8) & 0xff,
        ~length & 0xff,
        (~length >>> 8) & 0xff,
        ...data,
        ...be32(adler32(data)),
    ];
}

const be32 = (value) => [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
];

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
});

/** The CRC-32 every PNG chunk ends with, specification clause 5.3. */
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** The checksum a zlib stream ends with, RFC 1950. */
function adler32(bytes) {
    let low = 1;
    let high = 0;
    for (const byte of bytes) {
        low = (low + byte) % 65521;
        high = (high + low) % 65521;
    }
    return high * 65536 + low;
}

const base64 = (bytes) => btoa(String.fromCharCode(...bytes));

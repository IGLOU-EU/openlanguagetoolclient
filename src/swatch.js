/**
 * What says which kind of mistake something belongs to: a colour, and the name a
 * human reads for it. And the icon an entry with nothing to show carries to
 * claim the indicator column, which draws nothing at all.
 *
 * Both are files packaged with the extension, because the compose window takes
 * nothing else. Its own document, `messengercompose.xhtml`, declares `img-src
 * chrome: moz-icon:`, and Gecko checks a `data:` URI against that policy before
 * anything else, so a `data:image/png;base64,` icon is refused there and every
 * menu of the window draws the engine's torn page in its place. A packaged file,
 * which the schema resolves against `moz-extension:`, loads. It stays the one
 * way to put a colour on a menu item, since an extension cannot style one at
 * all, and it cannot be an SVG `data:` URL or an `ImageData` either: the schema
 * refuses both (`modules/Schemas.sys.mjs`, `imageDataOrStrictRelativeUrl`).
 *
 * The colours are still declared here and nowhere else. Each file is named after
 * the hexadecimal value it is drawn in, so its name says what it holds. The
 * shape is not stated here either: `test/icons.mjs` draws every packaged swatch
 * and says what one looks like, and `test/swatch.test.mjs` draws them all again
 * to hold the committed file, the picture and the table equal. A colour added to
 * the table is therefore drawn from there and never by hand.
 *
 * What is left to say here is the one property no drawing tool honours: a filter
 * byte of zero in front of every row, since filtering them compresses better.
 * The test reads the rows as they stand rather than carry a decoder of the five
 * filters for pictures that need none, so a file written by anything else has to
 * be written unfiltered too, and that test is what says whether it is.
 *
 * No Thunderbird API and no DOM, like the rest of the event page's modules, so
 * the whole thing is provable under Node.
 */

/**
 * One colour per family of mistake.
 *
 * The five are the very colours `src/compose.css` underlines the text with,
 * which it declares for itself: a stylesheet injected into the page being
 * written cannot read a module, and there is no build step to derive one side
 * from the other. `test/underline.test.mjs` holds the two copies equal instead,
 * so a mistake is never marked in one colour and named in another.
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
 * The icon for one colour, ready for `menus.create`.
 *
 * @param {string} color `#rrggbb`. Anything else gives the `other` swatch: a
 *        menu entry without its icon is a smaller loss than a right click that
 *        throws.
 * @returns {string} The name of a file packaged with the extension, relative
 *          with no leading slash, which is the form the schema resolves against
 *          `moz-extension:`. Every colour of `SWATCHES` has one.
 */
export function swatchFor(color) {
    const known = typeof color === "string" && HEX.test(color);
    const usable = known ? color.toLowerCase() : SWATCHES.other;
    return `swatch-${usable.slice(1)}.png`;
}

/**
 * The icon an entry with nothing of its own to show carries.
 *
 * It draws nothing, and it is there to claim the indicator column and for
 * nothing else. The platform keeps that column for the entries carrying an icon
 * and pads the others into it, so a menu mixing the two starts its labels at as
 * many places as it has kinds of entry.
 *
 * @returns {string} The name of a file packaged with the extension, transparent
 *          from edge to edge so that a light menu and a dark one both show
 *          through it.
 */
export function blankIcon() {
    return "blank.png";
}

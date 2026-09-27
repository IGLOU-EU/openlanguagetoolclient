/**
 * What the two menus show: the compose body's for one error, and the toolbar
 * button's own for the actions offered while writing.
 *
 * A module of the event page side, with no Thunderbird API and no DOM, so the
 * whole mapping is provable under Node where no menu exists. The event page is
 * left with nothing but the calls that create the entries and the sending of
 * what a click orders.
 */

import { blankIcon, choiceFor, familyOf, SWATCHES, swatchFor } from "./swatch.js";

/**
 * Longest list of replacements offered.
 *
 * A context menu with twenty entries is unusable, and LanguageTool orders its
 * replacements by likelihood, so what is cut is what was least likely anyway.
 */
export const MAX_REPLACEMENTS = 5;

/**
 * Longest explanation shown, in characters.
 *
 * A menu item is capped at 42em of its own font (`menu.css`,
 * `--menuitem-max-width`) and its label is cropped at the end by the layout
 * engine, out of reach of any extension. On a leaf carrying an icon that leaves
 * about 88 characters of French prose, so the string is shortened here, which is
 * the only lever there is, just under that.
 *
 * Exported because it caps every label this file writes, the descriptions of the
 * button's menu included, and a label cropped by the platform loses its end with
 * nothing to say it was there.
 */
export const MESSAGE_LIMIT = 80;

/** One character, so the shortening costs the text as little room as possible. */
const ELLIPSIS = "…";

/**
 * Turns one error into the entries to create, the explanation first and the
 * replacements after it.
 *
 * Nothing is nested, because two or more top level entries are what the platform
 * collapses into a single submenu named after the extension (`ext-menus.js`,
 * `buildTopLevelElements`, whose `maxCount` is 1 for a compose body click). That
 * grouping under the extension's name is the conventional shape for a secondary
 * path, which this menu is now that the panel offers the corrections. It also
 * buys the colour: an entry left at top level has its icon overwritten with the
 * extension's own, and inside the submenu every entry keeps the one it was given,
 * the explanation included.
 *
 * @param {object} match A match as `src/languagetool.js` normalizes it, with the
 *        covered text the compose script adds as `text`. Anything else, up to a
 *        value that is no object at all, yields no entry: it arrives as a message
 *        from another context, and a menu that throws would take the whole right
 *        click with it.
 * @param {number} limit How many replacements at most, `MAX_REPLACEMENTS` when
 *        missing or unusable.
 * @returns {{id: string, title: string, enabled: boolean, icons: object}[]}
 *          Empty when there is nothing to show. Only an enabled entry stands for
 *          a replacement, and the explanation is the one entry that refuses a
 *          click.
 */
export function menuItemsFor(match, limit) {
    const cap = Number.isFinite(limit) && limit >= 0 ? limit : MAX_REPLACEMENTS;
    const replacements = Array.isArray(match?.replacements) ? match.replacements : [];

    const items = [];

    const message = match?.message;
    if (typeof message === "string" && message !== "") {
        items.push({
            id: "olc-message",
            title: shortened(message),
            enabled: false,
            // The one line the colour is said on, which is the line that says
            // what is objected to. Repeated down every entry it says nothing
            // more than it says once.
            icons: { 16: swatchFor(SWATCHES[familyOf(match?.issueType)]) },
        });
    }

    // The rank counts the entries created, not the replacements read, so that
    // the ids stay distinct and contiguous whatever the server sent.
    let rank = 0;
    for (const value of replacements) {
        if (rank >= cap) {
            break;
        }
        const choice = choiceFor(value, match?.text);
        if (choice === null) {
            continue;
        }
        items.push({
            id: `olc-${rank}`,
            // The shown form and not the replacement itself, or a deletion is an
            // entry with no text at all. Its strikethrough is lost here, since
            // an extension cannot style a menu item.
            title: choice.text,
            enabled: true,
            // An icon that draws nothing, for the reason `iconic` below is given
            // one.
            icons: { 16: blankIcon() },
        });
        rank += 1;
    }

    return items;
}

function shortened(message) {
    if (message.length <= MESSAGE_LIMIT) {
        return message;
    }
    return message.slice(0, MESSAGE_LIMIT - ELLIPSIS.length) + ELLIPSIS;
}

/**
 * The glyph each ordinary entry of the button's menu shows.
 *
 * Packaged files, for the reason `src/swatch.js` gives for the swatches: the
 * compose window takes no other form of icon. They are named here and not there
 * because a glyph says what one entry of one menu does, where a swatch says what
 * family a mistake belongs to.
 *
 * Each file is one emoji character laid out in whatever the system has for it, so
 * the set costs no drawing and no second icon set to keep in step with the first.
 * An SVG used as an image reaches the system fonts, and the four glyphs were
 * checked painting in a real compose window rather than assumed to: nothing needs
 * rasterising into PNG for them.
 *
 * A globe for the language and not a flag: a white flag reads as surrender, and
 * any national flag picks one of the languages the menu offers over the others.
 */
const GLOBE = "glyph-globe.svg";
const MAGNIFIER = "glyph-magnifier.svg";
const ARROWS = "glyph-arrows.svg";
const GEAR = "glyph-gear.svg";

/**
 * Turns the state of one compose window into the entries of the button's menu.
 *
 * @param {{languages?: object[], language?: string, picky?: boolean, checking?: boolean}}
 *        state `languages` is the list the server offers, as
 *        `src/languagetool.js` returns it. `language` is the code in force, and
 *        nothing usable there means the server detects it. Anything else, up to
 *        a value that is no object at all, reads as the defaults: it is built
 *        from what another context reported, and a menu that throws would take
 *        the whole button with it.
 * @returns {{id: string, title?: string, type: string, checked?: boolean, icons?: object,
 *          enabled?: boolean, parentId?: string}[]} In the order the entries have
 *          to be created, a parent before its children, since a parent that does
 *          not exist yet cannot be named. A separator carries no title, and the
 *          two descriptions carry no icon.
 */
export function actionMenuItems(state) {
    const language = textOf(state?.language);
    const items = [
        iconic("olc-language", "Language", "normal", false, GLOBE),
        languageItem("olc-language-auto", "Detect automatically", language === ""),
    ];

    // The detection entry already holds the id a language called "auto" would
    // ask for, and two entries cannot share one.
    const taken = new Set(["auto"]);
    for (const entry of listOf(state?.languages)) {
        const name = textOf(entry?.name);
        const longCode = textOf(entry?.longCode);
        // A language with no name cannot be shown, one with no code cannot be
        // asked of the server, and one already listed would take the same id.
        if (name === "" || longCode === "" || taken.has(longCode)) {
            continue;
        }
        taken.add(longCode);
        items.push(languageItem(`olc-language-${longCode}`, name, longCode === language));
    }

    // A language named by the server with enough confidence is carried by every
    // request after it, so a paragraph written in another tongue keeps being
    // checked in the first one. Clicking the radio already marked is what hands
    // the say back to the detection, and an entry already marked is not one
    // anybody thinks of clicking.
    items.push(iconic("olc-redetect", "Detect the language again", "normal", false, MAGNIFIER));
    // A pass asked for from the keyboard leaves the cache standing, so a
    // paragraph unchanged since the last one is never sent again. Throwing that
    // cache away is the only way to have the whole message looked at.
    items.push(iconic("olc-recheck", "Check the whole message again", "normal", false, ARROWS));
    items.push(iconic("olc-options", "Settings", "normal", false, GEAR));

    // The two modes last, each behind a rule of its own. The rule comes before
    // the group and never after its description, or the menu ends on a rule with
    // nothing under it.
    items.push(separator("olc-picky-rule"));
    items.push(iconic("olc-picky", "Picky mode", "checkbox", state?.picky === true));
    items.push(description("olc-picky-note", "Also reports style and typography"));
    items.push(separator("olc-checking-rule"));
    items.push(iconic("olc-checking", "Check this message", "checkbox", state?.checking === true));
    items.push(
        description(
            "olc-checking-note",
            "Whether this message is checked at all, and off it is left alone",
        ),
    );

    return items;
}

/**
 * What a click in the button's menu orders of the compose window, or null when
 * the entry orders nothing of it.
 *
 * Read from the id, composed above, rather than remembered from the moment the
 * menu was built: nothing has to survive between the two. It sits with those ids
 * so that the pairing is provable under Node, an entry mapped to nothing being
 * an entry that silently does nothing and says so nowhere. The rules and the
 * descriptions are the exception the test names: neither takes a click at all.
 *
 * @param {{menuItemId: string, checked?: boolean}} info The click as the platform
 *        reports it, `checked` being the state it has just put the entry in.
 * @returns {object|null}
 */
export function orderFor(info) {
    // Detecting again is what the radio already marked orders, so there is
    // nothing new to order and nothing new to answer.
    if (info.menuItemId === "olc-language-auto" || info.menuItemId === "olc-redetect") {
        return { type: "language", language: null };
    }
    if (info.menuItemId.startsWith("olc-language-")) {
        return { type: "language", language: info.menuItemId.slice("olc-language-".length) };
    }
    if (info.menuItemId === "olc-picky") {
        return { type: "picky", picky: info.checked === true };
    }
    if (info.menuItemId === "olc-checking") {
        return { type: "checking", checking: info.checked === true };
    }
    if (info.menuItemId === "olc-recheck") {
        return { type: "recheck" };
    }
    return null;
}

const item = (id, title, type, checked) => ({ id, title, type, checked });

/**
 * An entry of the menu itself, which is an entry carrying an icon, and that is
 * what lines their labels up: the platform keeps the indicator column for the
 * entries that have one and pads the others into it, so a menu mixing the two
 * starts its labels at as many places as it has kinds of entry.
 *
 * The two checkboxes carry an icon nobody will ever see, hence the blank one they
 * are left with. The platform hides the icon of an entry of that type and draws
 * its own mark in the column instead
 * (`chrome/classic/skin/classic/messenger/contextMenu.css`), which is the
 * convention a checkbox is read with and is left alone. The icon is there for the
 * treatment the entry gets for having one, and for nothing else.
 */
const iconic = (id, title, type, checked, icon = blankIcon()) => ({
    ...item(id, title, type, checked),
    icons: { 16: icon },
});

/**
 * The rule that gives one group of entries its top edge.
 *
 * `separator` is one of the four types the schema takes, and the one type a title
 * is not required for (`schemas/menus.json`, `ItemType` and the `title` of
 * `create`). It still carries an id of its own, because the event page takes the
 * entries it created down by id.
 */
const separator = (id) => ({ id, type: "separator" });

/**
 * The line under a mode that says what that mode is for.
 *
 * No icon at all, and that is the point rather than an oversight: the platform
 * pushes an entry carrying none 24px and half an em to the right
 * (`chrome/classic/skin/classic/messenger/contextMenu.css`, the
 * `padding-inline-start` of `menuitem:not([checked], [icon], .menuitem-iconic)`),
 * and that indent is what binds the line to the entry above it. An icon here
 * would line it up with the modes and leave it reading as a third one.
 *
 * It refuses the click because it is a caption, and a caption that took one would
 * be an entry whose click does nothing.
 */
const description = (id, title) => ({ ...item(id, title, "normal", false), enabled: false });

/** Every child of the menu is a language, and radio because one is in force. */
const languageItem = (id, title, checked) => ({
    ...item(id, title, "radio", checked),
    parentId: "olc-language",
});

/** Anything that is not a name or a code is neither. */
function textOf(value) {
    return typeof value === "string" ? value.trim() : "";
}

function listOf(values) {
    return Array.isArray(values) ? values : [];
}

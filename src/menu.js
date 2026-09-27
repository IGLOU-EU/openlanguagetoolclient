/**
 * What the two menus show: the compose body's for one error, and the toolbar
 * button's own for the actions offered while writing.
 *
 * A module of the event page side, with no Thunderbird API and no DOM, so the
 * whole mapping is provable under Node where no menu exists. The event page is
 * left with nothing but the calls that create the entries.
 */

import { choiceFor, familyOf, SWATCHES, swatchFor } from "./swatch.js";

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
 */
const MESSAGE_LIMIT = 80;

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
    const icons = { 16: swatchFor(SWATCHES[familyOf(match?.issueType)]) };

    const items = [];

    const message = match?.message;
    if (typeof message === "string" && message !== "") {
        items.push({
            id: "olc-message",
            title: shortened(message),
            enabled: false,
            icons,
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
            icons,
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
 * Turns the state of one compose window into the entries of the button's menu.
 *
 * @param {{languages?: object[], language?: string, picky?: boolean, checking?: boolean}}
 *        state `languages` is the list the server offers, as
 *        `src/languagetool.js` returns it. `language` is the code in force, and
 *        nothing usable there means the server detects it. Anything else, up to
 *        a value that is no object at all, reads as the defaults: it is built
 *        from what another context reported, and a menu that throws would take
 *        the whole button with it.
 * @returns {{id: string, title: string, type: string, checked: boolean, parentId?: string}[]}
 *          In the order the entries have to be created, a parent before its
 *          children, since a parent that does not exist yet cannot be named.
 */
export function actionMenuItems(state) {
    const language = textOf(state?.language);
    const items = [
        item("olc-language", "Language", "normal", false),
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

    items.push(item("olc-picky", "Picky mode", "checkbox", state?.picky === true));
    items.push(item("olc-checking", "Check this message", "checkbox", state?.checking === true));
    items.push(item("olc-options", "Settings", "normal", false));

    return items;
}

const item = (id, title, type, checked) => ({ id, title, type, checked });

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

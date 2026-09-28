// Event page: it owns the network and the Thunderbird UI, and touches nothing of
// the DOM. The compose script holds the other half, because it can neither
// import a module nor obtain a host permission.
//
// Nothing is shared between the two files, not even a log function: a common
// file loaded in both contexts kills the compose script on its very first
// line.

import { buttonFor } from "./button.js";
import { check, languages } from "../languagetool.js";
import { actionMenuItems, menuItemsFor, orderFor } from "./menu.js";
import { DETECT_LANGUAGE, normalize } from "../settings.js";
import { choiceFor, familyOf, paintFor } from "./swatch.js";

// The prototype has no other feedback channel than standard output, which
// lancer.sh captures into the log.
const log = (...parts) => console.log("[OLC/background]", ...parts);

/**
 * The settings as the options page last stored them.
 *
 * Read again for every check rather than held: the event page unloads and comes
 * back during a session, and a setting changed in the options page has to take
 * effect on the next keystroke.
 */
async function serverConfig() {
    return normalize(await browser.storage.local.get(null));
}

/**
 * What each compose window last reported, by tab id.
 *
 * The button's menu shows the language in force, the picky mode and whether the
 * message is checked at all, and the compose window is the only side that knows
 * those three. The next state it sends says them again, so an event page that
 * unloaded costs at most a menu opened before the first check of a window,
 * which then shows what the settings say.
 */
const states = new Map();

/**
 * Puts one compose window's state on its own button, and keeps it for the menu.
 *
 * The button is scoped to the window the state came from, because two messages
 * being written at once must not show each other's count. That window is the
 * `tabId` of `sender.tab`: a standalone compose window counts as a tab for the
 * tab tracker, so a compose script's message carries one, and `windowId` is
 * rejected by these calls anyway (`ExtensionToolbarButtons.sys.mjs`,
 * `getTargetFromDetails`). Without a tab the same calls apply to every window,
 * which is the right fallback and costs no branch.
 *
 * @returns {Promise} Rejected when the window has gone, which the compose
 * script that sent the state swallows.
 */
function showState(state, tabId) {
    states.set(tabId, state);

    const { icon, text, background, textColor, title, label } = buttonFor(state);
    return Promise.all([
        browser.composeAction.setBadgeText({ tabId, text }),
        browser.composeAction.setBadgeBackgroundColor({ tabId, color: background }),
        browser.composeAction.setBadgeTextColor({ tabId, color: textColor }),
        browser.composeAction.setTitle({ tabId, title }),
        // The label is the language the check ran in, which the compose toolbar
        // shows beside the icon. The count is the badge's, and the two are read
        // in the same glance without being the same thing.
        browser.composeAction.setLabel({ tabId, label }),
        // Nothing can draw a border, a halo or a motion around the button, so
        // what the check is doing is shown inside the icon.
        browser.composeAction.setIcon({ tabId, path: icon }),
    ]);
}

/**
 * What a click on one of our menu entries has to send back, by entry id.
 *
 * A click says which entry was picked and nothing more, so what that entry
 * stands for is remembered here. It lives from one right click to the click
 * that follows it, which is short enough for an event page: if the page unloads
 * in between, a click writes nothing rather than writing the wrong thing.
 */
let pending = new Map();

/**
 * `menus.create` hands the id back at once and does the work afterwards, so its
 * callback is the only thing that says the entry exists. It has to exist before
 * `refresh`, which rebuilds the shown menu from the entries registered by then.
 */
function createMenu(properties) {
    return new Promise((resolve) => browser.menus.create(properties, resolve));
}

/** The entries each menu holds, by context, so a rebuild knows what to undo. */
const created = new Map();

/**
 * The entries of the previous session, taken away.
 *
 * An event page's entries are kept on disk, and `menus.create` refuses an id it
 * already knows, so the ones left behind have to go before this session creates
 * the same ids. It is awaited rather than fired and forgotten because the right
 * click that woke the page is served in the same breath, and would otherwise
 * have its entries taken away from under it.
 */
const cleared = browser.menus
    .removeAll()
    .catch((error) => log("menus not cleared:", String(error)));

/**
 * Puts one set of entries up in place of the set the same menu had.
 *
 * What was there goes first, for the same reason. Only this menu's own entries
 * go, and not every entry the extension has: the two menus are each rebuilt by
 * their own opening, so taking both down would leave whichever is opened next
 * with nothing to show until it is open. Taking a parent away takes its children
 * with it.
 *
 * `menus.refresh()` is what puts entries into a menu already on screen, and it
 * does nothing when none is.
 */
async function replaceItems(context, items) {
    await cleared;

    for (const id of created.get(context) ?? []) {
        await browser.menus.remove(id);
    }
    created.set(context, items.map((item) => item.id));

    for (const item of items) {
        await createMenu({ ...item, contexts: [context] });
    }
    await browser.menus.refresh();
}

/**
 * Offers the replacements for one error in the compose body's context menu, and
 * nothing at all when the right click was not on an error.
 *
 * The menu is already on screen by the time this runs. Thunderbird itself reads
 * the click coordinates from the DOM `contextmenu` event and builds the popup in
 * the same turn (`messengercompose.xhtml`, the `oncontextmenu` of the message
 * editor, then `msgComposeContextOnShowing`), so a message coming from the
 * compose script can never overtake it.
 *
 * The context stays `compose_body`, which is what keeps these entries out of the
 * button's own menu: an entry declared for `all` turns up there too
 * (`ext-menus.js`, `getMenuContexts`).
 */
async function showSuggestions(match) {
    const entries = menuItemsFor(match);

    pending = new Map();
    for (const entry of entries) {
        // Only a replacement is something to write, and it is the entry carrying
        // the value that is one: the line explaining the mistake has none, and it
        // is the one entry that refuses the click.
        if (!("value" in entry)) {
            continue;
        }
        pending.set(entry.item.id, {
            type: "apply",
            offset: match.offset,
            length: match.length,
            expected: match.text,
            value: entry.value,
        });
    }

    // The value stays out of what the platform is handed, because `menus.create`
    // is checked against the schema and refuses a property it does not know.
    const items = entries.map((entry) => entry.item);
    await replaceItems("compose_body", items);
    log(items.length, "menu entries for this right click");
}

/**
 * The languages the configured server offers, empty while none are known.
 *
 * Asked once and kept: the list only changes when the server does, and it is
 * lost with the event page, hence the asking again when it is not there. A
 * server that did not answer leaves it unset, so the next menu tries again
 * instead of offering nothing for as long as the page lives.
 */
let offered = null;

async function offeredLanguages(settings) {
    if (offered === null) {
        const answer = await languages(settings);
        if (answer.failure) {
            log("no language list:", answer.failure.kind, "|", answer.failure.detail);
            return [];
        }
        offered = answer.languages;
    }
    return offered;
}

/**
 * Puts the actions in the button's own menu, for the window it was opened in.
 *
 * What the compose window leaves unset is filled in from the settings here, the
 * way a check already takes its language from them: that window holds a choice
 * made for this message or nothing at all, and what nothing falls back to is the
 * event page's business, since it is the side that reads the settings.
 *
 * A message is checked unless its window has said otherwise, which is also what
 * a window that has not reported yet is doing.
 */
async function showActionMenu(tabId) {
    const settings = await serverConfig();
    const state = states.get(tabId) ?? {};

    const items = actionMenuItems({
        languages: await offeredLanguages(settings),
        language: state.language ?? configuredLanguage(settings),
        picky: state.picky ?? settings.picky,
        checking: state.checking ?? true,
    });
    await replaceItems("compose_action_menu", items);
    log(items.length, "entries in the button's menu");
}

/** The configured language, or nothing when the configuration asks for detection. */
function configuredLanguage(settings) {
    return settings.language === DETECT_LANGUAGE ? null : settings.language;
}

/**
 * This fires for the compose body's menu and for the right click on the button
 * as well, so the context is what tells them apart. Only the button's own menu is
 * rebuilt here: the body's is built by the right click that opens it, and the
 * right click on the button, capped at six top level entries, is offered nothing.
 */
browser.menus.onShown.addListener((info, tab) => {
    if (!info.contexts.includes("compose_action_menu")) {
        return;
    }
    showActionMenu(tab.id).catch((error) => log("menu not rebuilt:", String(error)));
});

// The click carries the window the menu was opened in, and the compose script of
// that window is the side that owns the DOM. `tabs.sendMessage` needs no
// permission of its own: only a tab's URL, title and icon are behind the `tabs`
// permission (`schemas/tabs.json`).
browser.menus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "olc-options") {
        browser.runtime
            .openOptionsPage()
            .catch((error) => log("options page not opened:", String(error)));
        return;
    }

    const order = pending.get(info.menuItemId) ?? orderFor(info);
    if (order === null) {
        return;
    }
    browser.tabs
        .sendMessage(tab.id, order)
        .catch((error) => log("order not sent:", String(error)));
});

/**
 * Checks one text with the stored settings.
 *
 * The compose script's language wins over the configured one, because it only
 * ever has one once the server named it with enough confidence on the very text
 * being written, or once the button's menu imposed one on this message. Until
 * then the configured language is what goes out, which is exactly what a user
 * who fixed a language asked for, and the client leaves the preferred variants
 * behind whenever a language is imposed either way.
 *
 * The picky mode travels the same way, for the same reason: the menu sets it for
 * one message, the settings for every other.
 */
async function checkFor(message) {
    const settings = await serverConfig();
    const result = await check(message.text, {
        ...settings,
        language: message.language ?? settings.language,
        picky: message.picky ?? settings.picky,
    });
    return { ...result, matches: result.matches.map((match) => painted(match, message.text)) };
}

/**
 * One match with its family, the colour and the name of its kind, and its
 * replacements as they are to be shown.
 *
 * Painted here because the panel showing them lives in a compose script, which
 * can import nothing: without this the colours would be copied into that script,
 * and `src/background/swatch.js` would stop being the one place they are declared.
 *
 * @param {object} match A match as `src/languagetool.js` normalizes it.
 * @param {string} sent The very text the match was reported on, which is where
 *        the covered text has to be read: the offsets count in it, whether it was
 *        one chunk or one block, and the event page has no DOM to read it from.
 */
function painted(match, sent) {
    const covered = sent.slice(match.offset, match.offset + match.length);
    return {
        ...match,
        ...paintFor(match.issueType, match.categoryName),
        // The family names the highlight the compose side draws the mark in,
        // and it is decided here for the same reason as the colour: the issue
        // types it is read from are grouped in `src/background/swatch.js`,
        // which that side cannot reach.
        family: familyOf(match.issueType),
        choices: choicesOf(match, covered),
    };
}

/**
 * The replacements of one match as they are shown, in the order the server sent
 * them and with a hole where one cannot be shown at all.
 *
 * @param {object} match The match, or nothing when the right click was on no
 *        error at all.
 * @param {string} covered The text the mistake covers.
 * @returns {({value: string, text: string, struck: boolean}|null)[]}
 */
const choicesOf = (match, covered) =>
    (match?.replacements ?? []).map((value) => choiceFor(value, covered));

/**
 * Whether one compose window is writing a plain text message.
 *
 * The compose script needs it and cannot read it: the `compose` module is
 * declared `"scopes": ["addon_parent"]` (`ext-mail.json`), so it is out of reach
 * of a content scope. What marks the quote and the signature differs between the
 * two modes, and the compose script is the side that skips them.
 *
 * @returns {Promise<boolean>} Rejected when the window has gone, which the
 * compose script that asked treats as the HTML mode.
 */
async function plainTextMode(tabId) {
    const details = await browser.compose.getComposeDetails(tabId);
    log("tab", tabId, "composes in", details.isPlainText ? "plain text" : "HTML");
    return details.isPlainText;
}

/**
 * The two settings the compose side draws and waits with, and nothing else.
 *
 * The shape of this answer is the contract: a compose script can read no
 * storage, and the server address has no business in the document being
 * written, which does nothing with it.
 *
 * @returns {Promise<{underline: string, idleSeconds: number}>}
 */
async function composeSettings() {
    const { underline, idleSeconds } = await serverConfig();
    return { underline, idleSeconds };
}

/**
 * Asks one compose window to close its panel, and says nothing of a window that
 * did not answer.
 *
 * A message that goes nowhere must not hold the send: the panel is a thing on
 * screen, and a compose window with no script left to answer has no panel
 * either.
 */
async function closePanel(tabId) {
    try {
        await browser.tabs.sendMessage(tabId, { type: "closePanel" });
    } catch (error) {
        log("panel not closed before sending:", String(error));
    }
}

/**
 * Takes the panel out of the document before the message is serialized.
 *
 * The send waits for this listener, and the panel's host element is a sibling of
 * `<body>`, which the serialization takes with the rest
 * (`modules/MessageSend.sys.mjs`, `_getBodyFromEditor`, which passes no
 * `OutputBodyOnly`). Nothing is returned: a falsy answer is what
 * `beforeSendEventTracker.handleEvent` skips over
 * (`chrome/messenger/content/messenger/parent/ext-compose.js`), so the message
 * goes out exactly as it stands. Answering with `details` instead would go
 * through `setComposeDetails`, which replaces the whole document and throws the
 * undo history away.
 */
browser.compose.onBeforeSend.addListener((tab) => closePanel(tab.id));

browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === "check") {
        return checkFor(message);
    }
    if (message?.type === "plainText") {
        return plainTextMode(sender.tab?.id);
    }
    if (message?.type === "settings") {
        return composeSettings();
    }
    if (message?.type === "state") {
        return showState(message, sender.tab?.id);
    }
    if (message?.type === "suggestions") {
        return showSuggestions(message.match);
    }
});

// The native spell checker would mark the same text a second time, and a
// single underline system must be the only thing on screen. The event page
// reloads during a session, hence a setting applied again on every load.
browser.messengerSettings.composeInlineSpellCheckEnabled
    .set({ value: false })
    .then(() => browser.messengerSettings.composeInlineSpellCheckEnabled.get({}))
    .then((state) => log("native spell checker:", JSON.stringify(state)))
    .catch((error) => log("cannot disable the native spell checker:", String(error)));

// A fresh install has no server address, and an extension that can reach no
// server does nothing at all without saying why.
browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === "install") {
        browser.runtime
            .openOptionsPage()
            .catch((error) => log("options page not opened:", String(error)));
    }
});

// The button's menu goes up at once and not only when it is first opened,
// because a menu shows what was already registered at the instant it opens, and
// is only corrected from there.
showActionMenu().catch((error) => log("menu not built:", String(error)));

serverConfig()
    .then((settings) =>
        log("event page loaded, server", settings.url === "" ? "not configured" : settings.url))
    .catch((error) => log("settings not readable:", String(error)));

// The extension's whole contract is that it reports a failure and never throws,
// so a promise nobody handled is the one failure that would leave no trace at
// all. Gecko prints it with no file and no line, which says nothing about where
// it came from, and this is what names it.
self.addEventListener("unhandledrejection", (event) =>
    log("nothing handled this rejection:", String(event.reason)));

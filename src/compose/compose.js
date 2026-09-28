// Compose script: it owns the DOM and touches nothing of the network. It reads
// the body being written, asks the event page for the check, converts the
// returned offsets into Ranges to underline them, names the error under a click,
// opens the panel that explains it, and writes the replacement the user picked
// from that panel or from the menu.
//
// Nothing is shared with background.js, not even a log function: a common
// file loaded in both contexts kills this script on its very first line.

// The prototype has no other feedback channel than standard output, which
// lancer.sh captures into the log.
const log = (...parts) => console.log("[OLC/compose]", ...parts);

// The thickness the settings ask for, unknown until the event page has
// answered. A highlight is named "olc-", the family of the mistake and that
// level, and such a name is the only link between the highlight registry and
// compose.css, which carries one rule per family and one per level.
let level = null;

// The highlight names on screen. A family the last pass drew and this one does
// not has to be taken out by name, and this is the only place that list exists:
// the compose side holds no copy of the families, which are declared in
// src/background/swatch.js and travel on each match.
let drawn = new Set();

// The family of a mistake the event page named nothing usable for. That field
// crosses a message boundary, so no pass may depend on it: this is the colour
// every mistake shared before the families existed, and a mark in it is still a
// mark, where a repaint that threw would leave the window with none and no way
// to get one back.
const FALLBACK_FAMILY = "other";

// Measured against the server: it refuses a text over 30,000 characters with an
// HTTP 413, and the public LanguageTool API stops at 20,000. Cutting at 20,000
// passes on both, and the margin costs nothing because a request stays under
// half a second up to that size.
const CHUNK_LIMIT = 20000;

// Below this the language the server announces is not to be trusted: measured
// at 0.20 on six characters and 0.66 on a twenty character paragraph, where it
// was wrong as often as right, against 0.99 from seventy four characters up.
const CONFIDENCE_FLOOR = 0.9;

// A compose script has no import, so the scripts loaded before this one hand
// over their API through globalThis.
const {
    flatten, locate, offsetOf, splitBlocks, beforeSignature, chunkBlocks,
    splitMatches, missingBlocks, matchesForBlocks, matchAt, blockAt,
    afterReplacement, prune,
} = globalThis.olcBody;
const { createScheduler } = globalThis.olcSchedule;
const panel = globalThis.olcPanel;

// One entry per block already checked, keyed by that block's exact text, so an
// edited paragraph misses and an untouched one hits without anything to
// compare. It lives in the compose window, which never reloads and lasts
// exactly as long as the cache is of any use.
let cache = new Map();

// One entry per paragraph just corrected, keyed by its text like the cache. A
// correction changes that text, so the cache stops holding anything about the
// paragraph and every mistake left in it would lose its underline until the
// server has answered again. These are the matches adjusted around the
// correction, and they serve the painting and the right click only. Nothing
// here ever decides what is sent: the corrected paragraph stays a cache miss,
// which is what makes the next pass ask about it and replace the guess with the
// server's answer.
let provisional = new Map();

// The language of the message, null until the server has named it with enough
// confidence. A wrong guess is not a missing answer: the server corrects with
// the dictionary of the language it believes, so a French paragraph taken for
// Italian comes back with Italian spelling errors.
let language = null;

// What the button's menu chose for this message alone, and for as long as this
// window lasts. A language and a picky mode stay null until they are chosen
// here, which is what leaves the configured ones in charge. A message is checked
// until it is taken out of the checking.
let forcedLanguage = null;
let picky = null;
let checking = true;

// Set when a choice made in the menu has made every cached answer worthless.
let cacheStale = false;

// Whether this message is written in plain text, unknown until the event page
// has answered. Only that side can read it, so the answer arrives after this
// script has run, and anything before it is treated as HTML.
let plainText = null;

/** The language the requests carry, null while none is in force. */
const languageInForce = () => forcedLanguage ?? language;

/**
 * The blocks of the flattened body, the signature dropped in a plain text
 * composition.
 *
 * Every pass, the right click and the write read the body through here, or one
 * of them would check text another one does not.
 *
 * The cut belongs to the plain text mode alone: there the signature is delimited
 * by a line of two hyphens and a space and by nothing else, while a user may
 * legitimately write such a line in an HTML message and would otherwise see the
 * rest of it silently stop being checked.
 */
function bodyBlocks(text) {
    const blocks = splitBlocks(text);
    return plainText === true ? beforeSignature(blocks) : blocks;
}

/** Returns null when a bound falls on a separator, which has no node. */
function toRange(segments, offset, length) {
    const start = locate(segments, offset, "start");
    const end = locate(segments, offset + length, "end");
    if (!start || !end) {
        return null;
    }
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
}

/**
 * Asks the event page to check one text.
 *
 * The picky mode rides along as it stands too, null while nothing but the
 * settings has a say in it.
 *
 * @param {string} text
 * @param {string|null} requested Language to impose, null to leave it to the
 *                                server's detection.
 * @returns {Promise<object|null>} Null when nothing usable came back: nothing
 * of it is cached, and the texts that did answer still get their underline.
 */
async function ask(text, requested) {
    let result;
    try {
        result = await browser.runtime.sendMessage({
            type: "check",
            text,
            language: requested,
            picky,
        });
    } catch (error) {
        // The event page unloads on its own, and a message lost with it must
        // not cost the whole pass.
        log("text not sent:", String(error));
        return null;
    }

    if (result.failure) {
        log("text without result:", result.failure.kind, "|", result.failure.detail);
        return null;
    }

    return result;
}

/**
 * Tells the event page what the toolbar button should show.
 *
 * Fire and forget, and a rejection dies here: the state is only feedback, and
 * it must never be able to cost a check.
 *
 * Every state carries the three choices of this window, because the button's
 * menu is drawn from them and the event page has no other way to learn them.
 *
 * @param {{busy: boolean, errors?: number, failed?: boolean}} state
 */
function sendState(state) {
    browser.runtime.sendMessage({
        type: "state",
        language: languageInForce(),
        picky,
        checking,
        ...state,
    }).catch(() => {});
}

/**
 * Checks one chunk and files its answer under every block it was made of.
 *
 * The language rides along as it stands: absent while it is still unknown, so
 * that the server names it, and imposed once the menu has chosen one or a chunk
 * has named it with enough confidence. A clean paragraph is remembered as clean,
 * which is what stops the next pass from asking about it again.
 *
 * @returns {Promise<boolean>} False when the chunk stays unchecked: nothing of
 * it is cached, and the chunks that did answer still get their underline.
 */
async function checkChunk(chunk) {
    const result = await ask(chunk.text, languageInForce());
    if (result === null) {
        return false;
    }

    for (const part of splitMatches(result.matches, chunk.parts)) {
        cache.set(part.text, part.matches);
    }
    if (language === null && result.confidence >= CONFIDENCE_FLOOR) {
        language = result.detectedLanguage;
    }

    return true;
}

/**
 * Takes the underline off the screen.
 *
 * Nothing is drawn before the event page has named the level, so there is
 * nothing to clear then either, and the registry is handed no name it could not
 * hold.
 */
function clearHighlight() {
    draw(new Map());
}

/**
 * Puts the ranges of each family on screen, and takes off the families left
 * without any.
 *
 * One highlight per family rather than one for every mistake: a ::highlight()
 * rule is selected by the name alone, so two colours on screen mean two names in
 * the registry. A name kept for a family this pass did not report would go on
 * marking mistakes nothing stands behind any more.
 *
 * @param {Map<string, Range[]>} byFamily
 */
function draw(byFamily) {
    const names = new Set();
    for (const [family, ranges] of byFamily) {
        const name = `olc-${family}-${level}`;
        names.add(name);
        CSS.highlights.set(name, new Highlight(...ranges));
    }

    for (const name of drawn) {
        if (!names.has(name)) {
            CSS.highlights.delete(name);
        }
    }
    drawn = names;
}

/**
 * Which of compose.css's five colours one match is drawn in.
 *
 * Read from the match and never worked out here: the families are grouped from
 * the server's issue types in src/background/swatch.js, which this side cannot reach.
 */
const familyIn = (match) =>
    typeof match.family === "string" && match.family !== "" ? match.family : FALLBACK_FAMILY;

/**
 * Turns what is remembered into the underline on screen, and tells the button
 * what it stands for.
 *
 * The body is flattened here and nowhere earlier, because the editor may have
 * moved on since: a paragraph edited meanwhile is a miss and waits for the next
 * pass. A fresh flattening also covers the nodes the editor split or merged,
 * since a Range is never kept from one pass to the next, it would absorb the
 * text inserted at its boundary.
 *
 * @param {boolean} failed True when a request came back with nothing.
 * @returns {{matches: object[], underlined: number, unplaced: number}} What a
 * pass reports in its log line.
 */
function repaint(failed) {
    const current = flatten(document.body);
    const currentBlocks = bodyBlocks(current.text);
    const matches = matchesForBlocks(currentBlocks, cache, provisional);

    // Grouped by family, because the colour of a mark comes from the name of the
    // highlight it was put in and from nowhere else.
    const byFamily = new Map();
    let underlined = 0;
    let unplaced = 0;
    for (const match of matches) {
        const range = toRange(current.segments, match.offset, match.length);
        if (range === null) {
            unplaced += 1;
            continue;
        }

        const family = familyIn(match);
        if (!byFamily.has(family)) {
            byFamily.set(family, []);
        }
        byFamily.get(family).push(range);
        underlined += 1;
    }

    draw(byFamily);

    cache = prune(cache, currentBlocks);
    provisional = prune(provisional, currentBlocks);

    // A refused request leaves its block out of the cache, so a pass against a
    // dead server always owes another one. Reporting that as a wait would leave
    // the button pending for ever, hence the failure being told first.
    const owed = missingBlocks(currentBlocks, cache).length > 0;
    sendState(failed
        ? { busy: false, errors: matches.length, failed: true }
        : { busy: owed, errors: matches.length, failed: false });

    return { matches, underlined, unplaced };
}

async function runCheck() {
    // A message taken out of the checking is left exactly as it stands.
    if (!checking) {
        return;
    }

    // The cache is thrown away here rather than when the menu was clicked,
    // because a pass already waiting on the server would otherwise file its
    // answers, produced under the previous choice, into the fresh cache.
    if (cacheStale) {
        cacheStale = false;
        cache = new Map();
        provisional = new Map();
    }

    // A pass asked for from the keyboard has no typing before it, so the button
    // learns of it here and not only from the input event.
    sendState({ busy: true });

    // What the body holds against what leaves the machine: skipping the quotes
    // and the signature, then the blocks already checked, is only worth
    // anything if that gap is visible.
    const bodyLength = document.body.textContent.length;
    const blocks = bodyBlocks(flatten(document.body).text);

    // As long as the language is unknown, the whole text goes out, cut into what
    // the server accepts: a lone paragraph is too short for it to name the
    // language, and it answers a wrong guess with that language's rules. Once
    // the language is known, only the paragraphs that changed go out, with it
    // imposed on each of them.
    const learning = languageInForce() === null;
    const toSend = learning ? blocks : missingBlocks(blocks, cache).map((text) => ({ text }));
    const chunks = chunkBlocks(toSend, CHUNK_LIMIT);
    const sentLength = chunks.reduce((total, chunk) => total + chunk.text.length, 0);

    // One chunk after the other, deliberately, never all at once. A pasted page
    // becomes a hundred and fifty paragraphs, and firing them together had the
    // server answer "too many parallel requests" to most of them. What sits at
    // the other end is often the free public instance or a small machine at
    // home, so the client stays gentle by default. A burst mode is easy to add
    // the day someone runs a server that wants one.
    let failed = 0;
    for (const chunk of chunks) {
        const answered = await checkChunk(chunk);
        if (!answered) {
            failed += 1;
        }
    }

    // The menu can take the message out of the checking while the server is
    // answering, and what was cleared then has to stay cleared.
    if (!checking) {
        log("pass dropped, this message is not checked any more");
        return;
    }

    const { matches, underlined, unplaced } = repaint(failed > 0);

    log(learning ? "whole text" : "changed blocks", "|",
        "language", languageInForce() ?? "unknown", "|",
        blocks.length, "blocks,", chunks.length, "requests,", failed, "failed |",
        sentLength, "characters sent of", bodyLength, "in the body |",
        matches.length, "errors returned,", underlined, "underlined,",
        unplaced, "not placed");
}

/**
 * The error the pointer sits on, with the text it covers, or null when it sits
 * on none.
 *
 * Nothing is kept between a pass and a right click: the matches are rebuilt
 * from what is remembered against the body as it stands, the guesses made
 * around a correction included, which costs nothing and can never be out of
 * date.
 *
 * The covered text travels with the match because the event page has no DOM of
 * its own, and it is what the write refuses to go ahead without.
 */
function matchUnder(event) {
    // A message taken out of the checking shows no underline, so offering a
    // correction for a mistake nothing points at would put one back.
    if (!checking) {
        return null;
    }

    // The menu's own info object carries no coordinates, and Thunderbird 155
    // never delivers the targetElementId its schema declares. The DOM event is
    // the only thing that says where the user clicked.
    const position = document.caretPositionFromPoint(event.clientX, event.clientY);
    if (!position) {
        return null;
    }

    const current = flatten(document.body);
    const offset = offsetOf(current.segments, position.offsetNode, position.offset);
    if (offset === null) {
        return null;
    }

    const matches = matchesForBlocks(bodyBlocks(current.text), cache, provisional);
    const found = matchAt(matches, offset);
    if (found === null) {
        return null;
    }

    return { ...found, text: current.text.slice(found.offset, found.offset + found.length) };
}

/**
 * Every error the message holds as it stands, and the text their offsets count
 * in.
 *
 * Rebuilt at the moment it is asked for, like the underline and the right click,
 * so the answer can never describe a text the window no longer holds. The covered
 * text travels with each error for the same reason as in `matchUnder`: whoever
 * asked has no DOM of its own, and it is what the write refuses to go ahead
 * without.
 *
 * @returns {{checking: boolean, body: string, mistakes: object[]}} The errors as
 * the event page painted them, in the order they come in the text, with offsets
 * counted in `body`. `checking` is what tells an empty list of a message that is
 * clean from an empty list of a message nothing has read, which is the whole
 * difference for whoever is about to send it.
 */
function currentMistakes() {
    // A message taken out of the checking shows no underline, so reporting its
    // errors anywhere would be marking what nothing else marks any more.
    if (!checking) {
        return { checking: false, body: "", mistakes: [] };
    }

    const current = flatten(document.body);
    const matches = matchesForBlocks(bodyBlocks(current.text), cache, provisional);

    return {
        checking: true,
        body: current.text,
        mistakes: matches.map((match) => ({
            ...match,
            text: current.text.slice(match.offset, match.offset + match.length),
        })),
    };
}

/**
 * Writes one replacement over the error it belongs to.
 *
 * @param {{offset: number, length: number, expected: string, value: string}} order
 *        `expected` is what the error covered when the menu was built. A
 *        replacement written anywhere else silently corrupts the message the
 *        user is about to send, so the write happens only where that text is
 *        still found.
 */
function applyReplacement({ offset, length, expected, value }) {
    const current = flatten(document.body);
    if (current.text.slice(offset, offset + length) !== expected) {
        log("replacement dropped, the text moved under it:", JSON.stringify(expected));
        return;
    }

    const range = toRange(current.segments, offset, length);
    if (range === null) {
        log("replacement dropped, no range for", offset, length);
        return;
    }

    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    // Through the editor rather than the DOM, so that Ctrl+Z takes the
    // correction back and the editor's own machinery sees the change. It fires
    // an input event of its own, which is what schedules the next check.
    if (!document.execCommand("insertText", false, value)) {
        log("replacement refused by the editor:", JSON.stringify(value));
        return;
    }

    // The paragraph is read before the write for the matches it is keyed by, and
    // again after it for the text it is keyed by now. The mistakes left in it
    // move by an amount the replacement makes known, so they are painted again
    // at once rather than after the pause and the round trip.
    const corrected = blockAt(bodyBlocks(current.text), offset);
    const written = corrected === null
        ? null
        : blockAt(bodyBlocks(flatten(document.body).text), corrected.start);
    if (written !== null) {
        const known = cache.get(corrected.text) ?? provisional.get(corrected.text) ?? [];
        provisional.set(
            written.text,
            afterReplacement(known, offset - corrected.start, length, value),
        );
    }

    repaint(false);
}

/**
 * Imposes a language on this message, or hands the say back to the detection.
 *
 * The learned language goes with the cache: it was named under the language
 * being left behind, and a detection asked for again has to be free to answer
 * something else.
 */
function forceLanguage(code) {
    forcedLanguage = typeof code === "string" && code !== "" ? code : null;
    language = null;
    recheck();
}

/** Sets the picky mode for this message, whatever the settings ask for. */
function setPicky(value) {
    picky = value === true;
    recheck();
}

/**
 * Takes this message out of the checking, or puts it back in.
 *
 * What is on screen goes with it: an underline no pass refreshes any more would
 * keep marking errors in a text nothing is reading.
 */
function setChecking(value) {
    checking = value === true;
    if (!checking) {
        clearHighlight();
        sendState({ busy: false, errors: 0, failed: false });
        return;
    }
    scheduler?.runNow();
}

/**
 * Checks again with nothing kept of what was cached, either because a choice
 * changed what the server is asked, or because the whole message was asked for
 * again.
 */
function recheck() {
    cacheStale = true;
    scheduler?.runNow();
}

/**
 * Checks now instead of at the end of the pause, with the cache left standing so
 * that only the paragraphs that changed go out.
 *
 * Nothing to run while no scheduler is built, so the settings are asked for again
 * exactly as a keystroke in the body does: see askForSettings.
 */
function checkNow() {
    if (scheduler === null) {
        askForSettings();
        return;
    }
    scheduler.runNow();
}

// Built only once the event page has said how long a wait to give it, hence the
// optional call at every place a pass is asked for. No delay is spelled out here
// to stand in meanwhile: it would be a second declaration of a value that belongs
// to the settings, and it would buy nothing, since an event page that cannot
// answer the settings cannot answer a "check" either and no pass would reach a
// server whatever wait this side picked.
let scheduler = null;

/** Puts the checking on the rhythm the settings ask for. */
function startScheduling({ underline, idleSeconds }) {
    // The one step whose success is otherwise silent, and whose absence is what
    // says a window is checking nothing.
    log("settings in force, wait", idleSeconds, "s, underline", underline);
    level = underline;
    scheduler = createScheduler({
        // Without this catch, a failure only surfaces as an "uncaught exception:
        // Object" that says nothing.
        run: () => runCheck().catch((error) => log("check interrupted:", String(error))),
        // The one place in the extension where seconds become milliseconds: the
        // wait is stored in the unit the human typed it in, and setTimeout takes
        // the other one.
        delay: idleSeconds * 1000,
        setTimer: setTimeout,
        clearTimer: clearTimeout,
    });
}

// One event for typing, pasting and undoing alike.
document.addEventListener("input", () => {
    if (!checking) {
        return;
    }
    if (scheduler === null) {
        // Nothing is scheduled, so nothing is coming, and the button must not be
        // told a pass is on its way. Ask again instead of giving up: see
        // askForSettings.
        askForSettings();
        return;
    }
    // The check is still a pause away, and the button has to say so at once or
    // the extension reads as dead for that whole pause.
    sendState({ busy: true });
    scheduler.request();
}, true);

// preventDefault is never called here: the native menu is the whole point, and
// the event is read for its coordinates and nothing else.
document.addEventListener("contextmenu", (event) => {
    browser.runtime
        .sendMessage({ type: "suggestions", match: matchUnder(event) })
        .catch((error) => log("suggestions not sent:", String(error)));
}, true);

/**
 * Opens the panel on the mistake a left click lands on, and leaves the click
 * alone when it lands on none.
 *
 * The bubble phase, where every other listener of this file captures: the panel
 * stops the clicks made inside itself, and that is what keeps a click on a
 * replacement from being read a second time as a click in the text.
 *
 * The box of the word comes from the very Range the underline is drawn from,
 * since nothing else knows where that word sits on screen.
 */
document.addEventListener("click", (event) => {
    const found = matchUnder(event);
    if (found === null) {
        return;
    }

    const current = flatten(document.body);
    const range = toRange(current.segments, found.offset, found.length);
    if (range === null) {
        log("panel dropped, no range for", found.offset, found.length);
        return;
    }

    panel.show({
        anchor: range.getBoundingClientRect(),
        match: found,
        language: languageInForce(),
        onApply: (value) => {
            // Closed first: the write moves the text the panel is sitting over,
            // and the panel is placed against where that text was.
            panel.hide();
            applyReplacement({
                offset: found.offset,
                length: found.length,
                expected: found.text,
                value,
            });
        },
    });
});

// What the event page sends: one order from the compose body's menu, four from
// the button's own, one from a keyboard shortcut, one from the send about to
// happen, and the question the window listing the errors asks through it.
browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "apply") {
        applyReplacement(message);
    }
    if (message?.type === "language") {
        forceLanguage(message.language);
    }
    if (message?.type === "picky") {
        setPicky(message.picky);
    }
    if (message?.type === "checking") {
        setChecking(message.checking);
    }
    if (message?.type === "recheck") {
        recheck();
    }
    if (message?.type === "checkNow") {
        checkNow();
    }
    if (message?.type === "mistakes") {
        // Answered rather than left silent, because the window that asked has no
        // other way of knowing what this message holds.
        return Promise.resolve(currentMistakes());
    }
    if (message?.type === "closePanel") {
        panel.hide();
        // Answered rather than left silent, because the event page holds the send
        // until this promise settles.
        return Promise.resolve(true);
    }
});

// Asked once: the mode is fixed by `makeEditable` when the compose window opens
// and nothing can change it afterwards. A failure leaves the body treated as
// HTML, which is what every pass before this answer does anyway.
browser.runtime
    .sendMessage({ type: "plainText" })
    .then((answer) => {
        plainText = answer;
    })
    .catch((error) => log("composition mode not known, treated as HTML:", String(error)));

/**
 * Asks the event page for the two settings the drawing and the rhythm are made
 * of, it being the only side that reads the storage.
 *
 * Asked at load and again on every key struck while nothing is scheduled, never
 * once and for all. The event page is suspended whenever it falls idle, and a
 * window that opens while it sleeps, or while it is going to sleep, gets an
 * answer that never arrives: the promise neither resolves nor rejects. Asking
 * once left such a window checking nothing for the rest of its life and saying
 * nothing about it, which is how this was found.
 */
function askForSettings() {
    browser.runtime
        .sendMessage({ type: "settings" })
        .then((settings) => {
            // Two answers can be in flight once a window has been typed into.
            if (scheduler === null) {
                startScheduling(settings);
                scheduler.request();
            }
        })
        .catch((error) => log("settings not known, nothing is checked yet:", String(error)));
}

askForSettings();

// The same reason as the event page's: a rejection nobody handled is the one
// failure this extension has no other way of reporting.
window.addEventListener("unhandledrejection", (event) =>
    log("nothing handled this rejection:", String(event.reason)));

log("compose script loaded.");

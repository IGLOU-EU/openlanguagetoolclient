// The window that lists every mistake of one message, so they are corrected one
// after another instead of being looked for in the text.
//
// It is a page of its own in a window of its own, so it owns neither the body
// being written nor the network: the mistakes are the compose script's, and the
// event page is the only context able to reach the compose window this window was
// opened for. Both the reading and the writing therefore go through it.
//
// It shares src/list/mistakes.js with that event page, so the name the compose
// window travels under is declared once, and what a row shows is provable under
// Node.
//
// One row per mistake, in the order of the text: the extract it sits in, what it
// is, how much of the text a correction would touch, the whole explanation and a
// button per replacement.

import { TAB_PARAMETER, extractOf, placeAfter, placeKept } from "./mistakes.js";

const status = document.getElementById("status");
const view = document.getElementById("view");

/**
 * The compose window this one was opened for, read from its own URL.
 *
 * From the URL and from nothing else, for the reason TAB_PARAMETER carries. A
 * window opened without it asks about nobody, which is answered like a message
 * that has gone.
 */
const composeTab = Number(new URLSearchParams(window.location.search).get(TAB_PARAMETER));

/**
 * What is said of a compose window that did not answer.
 *
 * The message may have been sent, closed or saved while this window stayed open,
 * and it says so instead of showing an empty list, which would read as a message
 * with nothing left to correct.
 */
const GONE = "The message this window was opened for is not there any more.";

/**
 * What is said of a message taken out of the checking.
 *
 * Its list is empty because nothing has read it, and the sentence for a message
 * with no mistake left would tell the writer their text is clean when nobody has
 * looked at it.
 */
const UNCHECKED = "Checking is off for this message, so nothing has been read.";

/**
 * How far one key moves in the list.
 *
 * A Map rather than an object, because the key struck is whatever the keyboard
 * sent and a plain object answers `constructor` with something inherited.
 */
const STEPS = new Map([["ArrowDown", 1], ["ArrowUp", -1]]);

/** The answer being shown, as it came. */
let shown = { body: "", mistakes: [] };

/** The place in that list the reader is on, and null while there is none to be on. */
let place = null;

/** The rows the arrow keys walk, in the order they are shown. */
let rows = [];

const report = (text) => {
    status.textContent = text;
};

/** Anything that is not a text is none. */
const textOf = (value) => (typeof value === "string" ? value : "");

const counted = (count) => `${count} character${count === 1 ? "" : "s"}`;

const summaryOf = (count) =>
    count === 0 ? "No mistake." : `${count} mistake${count === 1 ? "" : "s"}.`;

/**
 * Asks the compose window for the mistakes it holds.
 *
 * Asked at load and again whenever the channel has been down, never on a rhythm:
 * every other list arrives on its own, pushed by the event page when the message
 * changed. See `listen`.
 *
 * @param {number} standing The place to hold the reader at, which is the one they
 *        are on everywhere but at load.
 */
async function ask(standing) {
    update(await browser.runtime.sendMessage({ type: "mistakes", tabId: composeTab }), standing);
}

/**
 * Draws one answer from the compose window, wherever it came from.
 *
 * The one drawing path, so a list the reader asked for and a list that arrived on
 * its own can never read differently. The keyboard is the one thing the two do
 * not share: whoever asked moves it, and nothing else does.
 *
 * @param {object} answer The compose window's mistakes, as `mistakes` answers.
 * @param {number} standing The place whose mistake the reader is held on, and the
 *        place they are left at when that mistake is gone from the answer.
 */
function update(answer, standing) {
    if (answer?.gone === true) {
        forget();
        report(GONE);
        return;
    }
    // Anything but a message that says it is being checked reads as one that is
    // not: of the two sentences, that is the one claiming nothing about the text.
    if (answer?.checking !== true) {
        forget();
        report(UNCHECKED);
        return;
    }

    const was = shown.mistakes[standing] ?? null;
    shown = {
        body: textOf(answer?.body),
        mistakes: Array.isArray(answer?.mistakes) ? answer.mistakes : [],
    };
    place = placeKept(was, shown.mistakes, standing);
    report(summaryOf(shown.mistakes.length));
    draw();
}

/** Leaves the window holding nothing, for a message there is nothing to list of. */
function forget() {
    shown = { body: "", mistakes: [] };
    place = null;
    draw();
}

/**
 * Draws the list of what the message holds.
 *
 * Built again rather than edited, because a correction moves every offset after it
 * and what is on screen would have to be taught about each one.
 *
 * Rebuilding takes away how far the reader had scrolled and whatever held the
 * keyboard, and a list arriving on its own is not their doing, so both are put
 * back. The keyboard only if it was in the list already: a reader who is typing in
 * their message has it elsewhere, and this window has no business taking it. It
 * goes back on the row and never on the replacement that held it, because the
 * server may have answered this mistake with other replacements, and the button in
 * that place would write something nobody chose.
 */
function draw() {
    const scrolled = view.scrollTop;
    const held = view.contains(document.activeElement);
    view.textContent = "";
    rows = [];

    // The count above says what an empty region means. A frame drawn around
    // nothing would say a list failed instead.
    if (shown.mistakes.length === 0) {
        return;
    }

    drawRows();
    mark();
    view.scrollTop = scrolled;
    if (held) {
        focusPlace();
    }
}

/** Every mistake in one column, each row carrying its own corrections. */
function drawRows() {
    const list = newList();
    for (const [at, mistake] of shown.mistakes.entries()) {
        const row = rowFor(mistake);
        row.append(...resolutions(mistake, at));
        rows.push(row);
        list.append(row);
    }

    view.append(list);
}

/** The list the rows go in, with the keyboard already on it. */
function newList() {
    const list = document.createElement("ol");
    list.className = "list";
    list.addEventListener("keydown", walk);
    // A click in a row focuses it, and a Tab into one of its corrections counts as
    // reaching it, so both come through here. The click is listened to as well:
    // where a platform leaves a clicked row unfocused, the corrections of another
    // mistake would stay on screen.
    list.addEventListener("focusin", select);
    list.addEventListener("click", select);
    return list;
}

/**
 * What a row opens with: the text the mistake sits in, what the mistake is, and
 * how much of that text a correction would touch.
 */
function rowFor(mistake) {
    const extract = extractOf(shown.body, mistake);
    const item = document.createElement("li");
    // The family's colour travels with the mistake, src/background/swatch.js
    // being the one place it is declared and a stylesheet being unable to read
    // it, so it is set here and never named in list.css.
    item.style.borderInlineStartColor = textOf(mistake?.color);
    // Reachable by a click and by the arrow keys, and never by Tab: `mark` gives
    // the row being worked on the only way in, so one press does not walk down
    // every mistake of the message.
    item.tabIndex = -1;
    item.append(extractLine(extract, mistake), kindLine(mistake, extract));
    return item;
}

/** The text around the mistake, with the mistake itself set apart inside it. */
function extractLine(extract, mistake) {
    const line = document.createElement("p");
    line.className = "extract";
    const covered = document.createElement("strong");
    covered.textContent = extract.covered;
    covered.style.textDecorationColor = textOf(mistake?.color);
    // The marks come with the extract, so what says the text was cut is decided
    // where the cutting is.
    line.append(extract.opening + extract.before, covered, extract.after + extract.closing);
    return line;
}

/** What the mistake is called, and how much of the text it covers. */
function kindLine(mistake, extract) {
    const label = textOf(mistake?.label);
    const size = counted(extract.characters);
    return paragraph("kind", label === "" ? size : `${label}, ${size}`);
}

/**
 * What can be done about one mistake: the whole explanation, and one button per
 * replacement.
 *
 * @returns {Element[]} Empty for neither an explanation nor a replacement, which
 *          the row says by showing nothing more: the extract and the count are
 *          what is left, and they are enough to find the word and fix it by hand.
 */
function resolutions(mistake, at) {
    const parts = [];
    if (textOf(mistake?.message) !== "") {
        // In full and never shortened: reading the whole explanation is the
        // reason there is a window and not only a menu.
        parts.push(paragraph("message", mistake.message));
    }

    const fixes = replacements(mistake, at);
    if (fixes !== null) {
        parts.push(fixes);
    }
    return parts;
}

/**
 * One button per replacement, or null when the server offered none.
 *
 * Every one of them, where the panel and the menu keep five: those two are a
 * popup at a word and a line of a menu, and this window scrolls.
 */
function replacements(mistake, at) {
    const buttons = [];
    for (const choice of mistake?.choices ?? []) {
        // The event page leaves a hole where a replacement was no text at all,
        // and a hole is neither shown nor written.
        if (typeof choice?.value !== "string") {
            continue;
        }
        const button = document.createElement("button");
        // What the replacement does, which for a deletion or a whitespace is all
        // there is to see. The value is what gets written, never this.
        button.textContent = choice.text;
        if (choice.struck) {
            button.className = "struck";
        }
        button.addEventListener("click", () => {
            apply(at, mistake, choice.value).catch((error) =>
                report(`Nothing written: ${error}`));
        });
        buttons.push(button);
    }

    if (buttons.length === 0) {
        return null;
    }
    const line = document.createElement("p");
    line.className = "fixes";
    line.append(...buttons);
    return line;
}

/**
 * Says which row is being worked on.
 *
 * The row being worked on and the row the keyboard is on are two different
 * things, and they are said differently: the focus goes off to one of the row's
 * corrections while the row itself stays the one being worked on.
 */
function mark() {
    for (const [at, row] of rows.entries()) {
        const here = at === place;
        row.classList.toggle("current", here);
        row.tabIndex = here ? 0 : -1;
        if (here) {
            row.setAttribute("aria-current", "true");
        } else {
            row.removeAttribute("aria-current");
        }
    }
}

/** Puts the reader on one place of the list, as near the one asked for as it holds. */
function moveTo(at) {
    const found = placeAfter(at, rows.length);
    if (found === null) {
        return;
    }
    place = found;
    mark();
    focusPlace();
}

/** Puts the keyboard on the row being worked on, when there is one. */
function focusPlace() {
    if (place !== null) {
        rows[place]?.focus();
    }
}

/** The row a click or a Tab landed in is the one being worked on. */
function select(event) {
    const at = rows.indexOf(event.target.closest("li"));
    if (at === -1 || at === place) {
        return;
    }
    place = at;
    mark();
}

/**
 * The arrow keys down the list, and the way from a row to its corrections.
 *
 * Answered only for a row, so a key struck in a correction stays the button's
 * own: Enter there is what applies it.
 */
function walk(event) {
    if (!rows.includes(event.target)) {
        return;
    }

    const step = STEPS.get(event.key);
    if (step !== undefined) {
        event.preventDefault();
        moveTo(place + step);
        return;
    }
    if (event.key === "Home") {
        event.preventDefault();
        moveTo(0);
        return;
    }
    if (event.key === "End") {
        event.preventDefault();
        moveTo(rows.length - 1);
        return;
    }
    if (event.key === "Enter") {
        // The corrections of the row the reader is on, so one is reached and
        // applied without the mouse.
        event.preventDefault();
        rows[place]?.querySelector("button")?.focus();
    }
}

/** Writes one replacement into the message, through the compose window that owns it. */
async function apply(at, mistake, value) {
    const answer = await browser.runtime.sendMessage({
        type: "apply",
        tabId: composeTab,
        offset: mistake.offset,
        length: mistake.length,
        // What the mistake covered when this list was drawn. The compose side
        // writes only where that text is still found, which is what makes an
        // offset gone stale cost one correction and never the message.
        expected: mistake.text,
        value,
    });

    if (answer?.gone === true) {
        forget();
        report(GONE);
        return;
    }

    // The write moves every mistake after it in the paragraph, so the list is
    // asked for again rather than left describing the text as it was. The place
    // the corrected one held is where the next one now is, and the keyboard goes
    // there, so the next correction is one key away. This is the one update the
    // reader did ask for, hence the only one that moves the keyboard.
    await ask(at);
    focusPlace();
}

function paragraph(className, content) {
    const element = document.createElement("p");
    element.className = className;
    element.textContent = content;
    return element;
}

/**
 * Opens the channel the event page pushes every later list down.
 *
 * A port and not a question asked over and over: the event page learns from the
 * compose window when the message changed, and pushing it here costs nothing
 * while nothing is being written. The port is also the one thing that says this
 * window is open, which is why the event page holds no pairing of its own: it is
 * suspended whenever it falls idle, so anything remembered there would die under
 * a window still on screen, while a port and the memory of it die together.
 *
 * Which message this window lists is not on the port: the URL says that, and it
 * is the one place that survives the event page unloading.
 */
function listen() {
    const port = browser.runtime.connect();
    port.onMessage.addListener((answer) => update(answer, place));
    // That suspension takes the event page's end of the port with it, and a window
    // left holding a dead port would go quietly out of date for the rest of its
    // life. Connecting again is also asking again, since whatever changed while
    // there was no channel was pushed to nobody.
    port.onDisconnect.addListener(() => {
        listen();
        ask(place).catch((error) => report(`The mistakes could not be read: ${error}`));
    });
}

/**
 * The mistakes, from the top.
 *
 * A window that cannot say what it holds has to say that much: it is the one thing
 * standing between the reader and a list that is silently empty.
 */
async function start() {
    listen();
    await ask(0);
    // The window was opened to walk this list, and nothing else in it wants the
    // keyboard first.
    focusPlace();
}

start().catch((error) => report(`The mistakes could not be read: ${error}`));

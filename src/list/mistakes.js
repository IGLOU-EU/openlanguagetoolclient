/**
 * What the window listing the mistakes of a message needs that is neither DOM
 * nor Thunderbird: where its page sits, how it is told which message it was
 * opened for, what one mistake is shown as, which place in the list the reader is
 * left on, and where the window itself opens.
 *
 * No Thunderbird API and no DOM, like the event page's own modules, so the
 * extract, its count, the placement and the step from one mistake to the next are
 * provable under Node where no window exists. The page is left with reading the
 * answer and building the list, and the event page with reading the geometry and
 * opening the window.
 *
 * Both of those sides import this file, which is what keeps the page's path and
 * the name the compose window travels under from being written twice.
 */

/**
 * The page the window shows, relative to the extension's root, which is the form
 * `runtime.getURL` resolves.
 *
 * Declared here rather than in the event page that opens it, because
 * `src/manifest.json` names no page opened with `windows.create` and there is
 * therefore nothing in the manifest to read it from.
 */
export const PAGE = "list/list.html";

/**
 * The URL parameter the compose tab travels in.
 *
 * The window is opened for one message and can reach it only through the event
 * page, so it has to name that message in every request. The URL carries it
 * because nothing else lasts: the event page unloads whenever it falls idle, so
 * a pairing remembered there would be lost under a window that is still open,
 * and the page would be left asking about nobody for the rest of its life.
 */
export const TAB_PARAMETER = "tab";

/**
 * The size the window opens at, in pixels.
 *
 * The list is one column, held to the measure a line is read at, and the width is
 * that measure plus the room the region and a scrollbar take beside it. Anything
 * wider would leave the column afloat in empty canvas, since it does not stretch.
 *
 * The window is resizable, so this is where it starts and not where it stays.
 */
export const WINDOW_WIDTH = 560;
export const WINDOW_HEIGHT = 600;

/**
 * The mark that says the extract was cut where it stands.
 *
 * One character, and the one a reader already reads as text left out. Declared
 * here with the cut it stands for, so the page never has to know what it is.
 */
export const ELLIPSIS = "…";

export const CONTEXT = 30;

/** The separator the compose side puts between two blocks of the body. */
const SEPARATOR = "\n";

/**
 * One mistake as the list shows it: the text it sits in, cut around it, how much
 * of that text the correction would touch, and where the cutting took text away.
 *
 * @param {string} text The flattened body the offsets count in, as the compose
 *        window answered it.
 * @param {{offset: number, length: number}} mistake A match as
 *        `src/languagetool.js` normalizes one. Nothing else of it is read.
 * @returns {{before: string, covered: string, after: string, characters: number,
 *          opening: string, closing: string}} The three pieces are the body's own
 *          text and carry no mark of their own, so what is read in a row is what
 *          is found in the message. `opening` and `closing` are the mark, and the
 *          empty string on a side the paragraph ended before the context did.
 *          Everything empty and a count of zero for a mistake that describes no
 *          span of that text, and it never throws: the pair arrives as a message
 *          from another context, and a message that has moved on since is the
 *          ordinary case.
 */
export function extractOf(text, mistake) {
    const body = typeof text === "string" ? text : "";
    const offset = mistake?.offset;
    const length = mistake?.length;
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0
        || offset + length > body.length) {
        return { before: "", covered: "", after: "", characters: 0, opening: "", closing: "" };
    }

    const end = offset + length;
    // Bounded by the paragraph the mistake sits in, because the separator is
    // where the writer sees a line end: an extract reaching over it would read as
    // one sentence where there are two.
    const starts = body.lastIndexOf(SEPARATOR, offset - 1) + 1;
    const next = body.indexOf(SEPARATOR, end);
    const ends = next === -1 ? body.length : next;
    const from = Math.max(starts, offset - CONTEXT);
    const to = Math.min(ends, end + CONTEXT);

    const covered = body.slice(offset, end);
    return {
        before: body.slice(from, offset),
        covered,
        after: body.slice(end, to),
        // Counted as a reader counts them: an offset is in UTF-16 code units,
        // where an emoji is two, and a row is read by a human.
        characters: [...covered].length,
        // Marked only where the context is what stopped the extract. A paragraph
        // that ended first left nothing out, and a mark there would send the
        // reader looking for words their message does not hold.
        opening: from > starts ? ELLIPSIS : "",
        closing: to < ends ? ELLIPSIS : "",
    };
}

/**
 * The place in the list the reader is left on, after the one at `resolved` was
 * corrected and the list asked for again.
 *
 * The corrected mistake is gone from that list and every mistake after it has
 * moved up by one, so the place the reader was at is where the next one now
 * sits: resolving the third of seven lands on what is now the third, which is the
 * one that followed it, never back at the top and never past it. Resolving the
 * last one leaves the new last, because nothing followed it and the top is not
 * where the reader was.
 *
 * It is the same arithmetic a step of the arrow keys needs, a place asked for
 * bounded by what the list holds, so both go through here.
 *
 * @param {number} resolved The place that was resolved, counted from zero.
 * @param {number} remaining How many mistakes the list holds now.
 * @returns {number|null} Null when there is nothing left to stand on, which is
 *          what a message whose last mistake was just corrected answers. A place
 *          that is no place reads as the first, so a list with anything in it
 *          always has somewhere for the reader to be.
 */
export function placeAfter(resolved, remaining) {
    if (!Number.isInteger(remaining) || remaining <= 0) {
        return null;
    }
    if (!Number.isInteger(resolved) || resolved < 0) {
        return 0;
    }
    return Math.min(resolved, remaining - 1);
}

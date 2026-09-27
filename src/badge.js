/**
 * What the compose window's toolbar button shows for a given state.
 *
 * A module of the event page side, with no Thunderbird API and no DOM, so the
 * whole mapping is provable under Node where no toolbar exists. The event page
 * is left with nothing but the calls that paint it.
 */

/**
 * Grey for everything that is not a count of mistakes: a check under way, an
 * unreachable server, a clean text. The badge's own default background is red,
 * so a state that is not an error count has to say otherwise or it would read
 * as one.
 */
export const BADGE_PENDING = "#6b7280";

/** Red for a count of mistakes, the one state that asks for attention. */
export const BADGE_ERRORS = "#c0392b";

/** White reads on both of the above. */
export const BADGE_TEXT = "#ffffff";

/**
 * Above this the badge shows 99 and the title keeps the true count.
 *
 * Two characters is what fits: the badge is 20 pixels wide at a 10 pixel font,
 * and a third one is already shaved at both ends. The exact number of a text
 * that bad changes nothing for whoever reads it anyway.
 */
const BADGE_LIMIT = 99;

/**
 * Turns a state into what the button displays.
 *
 * @param {{busy?: boolean, errors?: number, failed?: boolean, language?: string}}
 *        state Anything else, up to a value that is no object at all, reads as
 *        the defaults: it arrives as a message from another context, and a
 *        button that throws would take the state of the whole window with it.
 * @returns {{text: string, background: string, textColor: string, title: string, label: string}}
 *          An empty `text` clears the badge, which is how a clean message shows
 *          nothing at all. An empty `label` leaves the platform falling back to
 *          the title, which is what a window with no language in force gets.
 */
export function badgeFor(state) {
    // The language is what the checking is being done in, whatever the checking
    // is doing at that instant, so every state carries it.
    const label = labelOf(state?.language);

    if (state?.busy) {
        return badge("…", BADGE_PENDING, "Checking", label);
    }
    if (state?.failed) {
        return badge("!", BADGE_PENDING, "LanguageTool could not be reached", label);
    }

    const errors = countOf(state?.errors);
    if (errors === 0) {
        return badge("", BADGE_PENDING, "No mistake found", label);
    }

    return badge(
        String(Math.min(errors, BADGE_LIMIT)),
        BADGE_ERRORS,
        errors === 1 ? "1 mistake" : `${errors} mistakes`,
        label,
    );
}

function badge(text, background, title, label) {
    return { text, background, textColor: BADGE_TEXT, title, label };
}

/**
 * The language beside the icon, upper cased because it stands for a language
 * and not for a code to be typed anywhere.
 */
function labelOf(language) {
    return typeof language === "string" ? language.trim().toUpperCase() : "";
}

/** Anything that is not a count of something is a count of nothing. */
function countOf(value) {
    return Number.isFinite(value) && value >= 0 ? value : 0;
}

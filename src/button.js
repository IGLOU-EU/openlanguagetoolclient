/**
 * What the compose window's toolbar button shows for a given state.
 *
 * A module of the event page side, with no Thunderbird API and no DOM, so the
 * whole mapping is provable under Node where no toolbar exists. The event page
 * is left with nothing but the calls that paint it.
 *
 * The icon says what the check is doing and the badge how many mistakes it
 * found. The two never have to choose: the badge is the icon's sibling in a
 * stack, so a count rides over whatever icon is showing.
 *
 * The count sits in the badge and not drawn large where the icon is, because no
 * text of the extension's can go there. That slot is an image whose only content
 * is a resolved URL, its box is nailed to eighteen pixels by the chrome's own
 * stylesheet whatever the image turns out to be, and an empty path falls back to
 * Thunderbird's generic icon rather than to nothing. The button offers three
 * text surfaces and no fourth: this badge, the label beside it, and the tooltip.
 * Drawing a count large therefore means one packaged file per value, which was
 * built and measured at thirty six kilobytes on a fifty five kilobyte extension,
 * then dropped.
 */

/**
 * A check under way, three middle dots and not U+2026.
 *
 * The ellipsis glyph sits on the baseline, which lands it on the bottom of the
 * ring, where these three sit at its centre. Exported because `test/icons.mjs`
 * draws the icons and the wait is the one that breathes.
 */
export const BUSY_MARK = "···";

/** A pass that never reached the server. */
const ALERT_MARK = "!";

/** The logo, the wavy line alone, which is a message with nothing to say. */
const LOGO = "icon.svg";

/**
 * The file that shows each of the two states that are not a count.
 *
 * A toolbar icon is chosen among packaged files and can never be drawn: the
 * `path` of `setIcon` is validated as a relative URL, and an `imageData` is
 * turned into a `data:` PNG the compose window's CSP refuses. These two keep the
 * ring because they report something happening and not a number, and
 * `test/icons.mjs` draws both of them from these very pairs.
 */
export const STATE_ICONS = {
    [ALERT_MARK]: "icon-alert.svg",
    [BUSY_MARK]: "icon-busy.svg",
};

/**
 * The colour a count sits on, and the only one the badge needs.
 *
 * There is no second colour because there is no second thing in the badge: a
 * check under way and a server out of reach are read off the icon now, so the
 * grey that used to tell those two apart from a count has nothing left to mark.
 * What the badge holds always asks for attention, so it is always red. Both
 * colours are set rather than left to the platform's own default, and they do
 * land: neither underlying rule carries `!important`, and the platform writes
 * what these calls say as an inline style.
 *
 * A darker red than the icons' #e74c3c, and the two are not to be unified: they
 * answer opposite constraints. The icon is judged against the toolbar behind it,
 * where #e74c3c clears 3:1 on both the light and the dark one and #c0392b falls
 * to 2.5:1 on the dark. The badge is judged against the white text on top of it,
 * where #c0392b gives 5.4:1 and #e74c3c only 3.8:1, under the 4.5:1 a ten pixel
 * digit asks for. Sharing the value with the misspelling swatch is a
 * coincidence and not a link.
 */
export const BADGE_BACKGROUND = "#c0392b";

/** White, which reads on the above at 5.4:1. */
export const BADGE_TEXT = "#ffffff";

/**
 * Above this the badge shows `BADGE_CAP` and the title keeps the true count.
 *
 * Two characters is what fits. The badge's label is capped at 20 pixels with 2
 * of padding on each side at a 10 pixel font, which leaves sixteen for the
 * glyphs (`chrome/toolkit/skin/classic/global/toolbarbutton.css` and the shared
 * design tokens it reads). A third character overflows by about a pixel and is
 * shaved at both ends, there being no ellipsis to crop it with, and a fourth is
 * plainly cut.
 */
const BADGE_LIMIT = 99;

/**
 * What a count past the limit shows.
 *
 * One character, which at the ten pixels the badge is painted at is the whole
 * point: an infinity sign was tried there and came out a thin smear, and the
 * badge's font size is not ours to raise, the platform writing nothing into it
 * but the two colours. It claims no number, where a button reading `99` for a
 * hundred and twenty one mistakes states something false, and the title, which
 * never caps, is where the real count is read.
 */
const BADGE_CAP = "+";

/**
 * Turns a state into what the button displays.
 *
 * @param {{busy?: boolean, errors?: number, failed?: boolean, language?: string}}
 *        state Anything else, up to a value that is no object at all, reads as
 *        the defaults: it arrives as a message from another context, and a
 *        button that throws would take the state of the whole window with it.
 * @returns {{icon: string, text: string, background: string, textColor: string,
 *          title: string, label: string}} The `icon` is a file packaged with the
 *          extension, relative with no leading slash, which is the form the
 *          schema resolves against `moz-extension:`. An empty `text` clears the
 *          badge, which is how every state but a count shows none. An empty
 *          `label` leaves the platform falling back to the title, which is what
 *          a window with no language in force gets.
 */
export function buttonFor(state) {
    // The language is what the checking is being done in, whatever the checking
    // is doing at that instant, so every state carries it.
    const label = labelOf(state?.language);

    if (state?.busy) {
        return button(STATE_ICONS[BUSY_MARK], "", "Checking", label);
    }
    // Nobody asked for this state, and it says itself for the same reason as
    // the others: the icon is all the button has to report what the check did,
    // and a pass that reached no server would otherwise wear the logo and read
    // as a message with nothing wrong with it.
    if (state?.failed) {
        return button(STATE_ICONS[ALERT_MARK], "", "LanguageTool could not be reached", label);
    }

    const errors = countOf(state?.errors);
    if (errors === 0) {
        return button(LOGO, "", "No mistake found", label);
    }

    return button(
        LOGO,
        errors > BADGE_LIMIT ? BADGE_CAP : String(errors),
        errors === 1 ? "1 mistake" : `${errors} mistakes`,
        label,
    );
}

function button(icon, text, title, label) {
    return { icon, text, background: BADGE_BACKGROUND, textColor: BADGE_TEXT, title, label };
}

/**
 * The language beside the icon, upper cased because it stands for a language
 * and not for a code to be typed anywhere.
 */
function labelOf(language) {
    return typeof language === "string" ? language.trim().toUpperCase() : "";
}

/**
 * Anything that is not a count of something is a count of nothing.
 *
 * Whole numbers only: a fraction would spend on a decimal point and a decimal
 * the room the badge has for two glyphs, and half a mistake is not something a
 * count of mistakes can hold anyway.
 */
function countOf(value) {
    return Number.isInteger(value) && value >= 0 ? value : 0;
}

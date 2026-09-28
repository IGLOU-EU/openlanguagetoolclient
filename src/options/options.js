// The options page. It is the only place the server address is entered, so it is
// also the place that asks for the host permission covering it, which the
// platform grants only from a user gesture.
//
// It shares src/settings.js with the event page, so the shape of a setting and
// the rules on it are declared once, and src/languagetool.js, so the language
// menus are filled by the same client that runs the checks.

import { languages } from "../languagetool.js";
import {
    DETECT_LANGUAGE,
    MAX_IDLE_SECONDS,
    MIN_IDLE_SECONDS,
    normalize,
    originOf,
    problemsWith,
    UNDERLINES,
} from "../settings.js";

const form = document.getElementById("settings");
const fields = {
    url: document.getElementById("url"),
    language: document.getElementById("language"),
    motherTongue: document.getElementById("mother-tongue"),
    variants: document.getElementById("variants"),
    picky: document.getElementById("picky"),
    underline: document.getElementById("underline"),
    idleSeconds: document.getElementById("idle-seconds"),
};
const variantsNote = document.getElementById("variants-note");
const status = document.getElementById("status");

// The words a level is shown with belong to the page and not to the settings,
// which name no screen. A level with no word here is shown by its own value, so
// a level added to the list is never an empty line in the menu.
const UNDERLINE_LABELS = { thin: "Thin", normal: "Normal", thick: "Thick" };

// The languages as the server last named them. An empty list is what a server
// that never answered leaves behind, and the menus have to hold the saved
// settings all the same.
let offered = [];

// The levels and the bounds are read from the settings module instead of being
// restated here, so the form can only offer what normalize accepts.
for (const level of UNDERLINES) {
    fields.underline.add(new Option(UNDERLINE_LABELS[level] ?? level, level));
}
fields.idleSeconds.min = MIN_IDLE_SECONDS;
fields.idleSeconds.max = MAX_IDLE_SECONDS;

function report(text, problem = false) {
    status.textContent = text;
    status.className = problem ? "problem" : "";
}

/** What the form holds, normalized, hence ready to be stored. */
function fromForm() {
    return normalize({
        url: fields.url.value,
        language: fields.language.value,
        motherTongue: fields.motherTongue.value,
        preferredVariants: [...fields.variants.selectedOptions].map((option) => option.value),
        picky: fields.picky.checked,
        underline: fields.underline.value,
        // An empty field reads as NaN, which normalize answers with the default.
        idleSeconds: Number(fields.idleSeconds.value),
    });
}

function fill(settings) {
    fields.url.value = settings.url;
    fields.picky.checked = settings.picky;
    fields.underline.value = settings.underline;
    fields.idleSeconds.value = settings.idleSeconds;
    fillMenu(fields.language, settings.language);
    fillMenu(fields.motherTongue, settings.motherTongue);
    fillVariants(settings.preferredVariants);
    applyVariantRule();
}

/**
 * Puts the offered languages in one menu, behind the entry the page declares
 * itself, and selects the saved value.
 *
 * A saved value the server did not offer gets an entry of its own, because a
 * server that is down must not be able to turn a setting into something else
 * the next time the page is saved.
 */
function fillMenu(menu, selected) {
    while (menu.options.length > 1) {
        menu.remove(1);
    }
    for (const language of offered) {
        menu.add(new Option(language.name, language.longCode));
    }

    const known = offered.some((language) => language.longCode === selected);
    if (!known && selected !== menu.options[0].value) {
        menu.add(new Option(selected, selected));
    }

    menu.value = selected;
}

/** A variant is an entry the server spells differently long and short. */
function fillVariants(selected) {
    const variants = offered.filter((language) => language.longCode !== language.code);

    fields.variants.textContent = "";
    for (const language of variants) {
        fields.variants.add(new Option(language.name, language.longCode));
    }
    for (const code of selected) {
        if (!variants.some((language) => language.longCode === code)) {
            fields.variants.add(new Option(code, code));
        }
    }

    for (const option of fields.variants.options) {
        option.selected = selected.includes(option.value);
    }
}

/**
 * Closes the variants as soon as a language is imposed.
 *
 * The server answers HTTP 400 to that pair, and the check then returns nothing
 * at all, so the form must not be able to express it.
 */
function applyVariantRule() {
    const imposed = fields.language.value !== DETECT_LANGUAGE;
    fields.variants.disabled = imposed;
    variantsNote.hidden = !imposed;
}

/**
 * Asks the address on the form what languages it offers and redraws the menus.
 *
 * A server that does not answer leaves every setting as it stands: a list that
 * could not be fetched says nothing about what the user chose.
 */
async function loadLanguages() {
    const settings = fromForm();
    const problems = problemsWith(settings);
    if (problems.length > 0) {
        report(problems.join(" "), true);
        return;
    }

    report("Asking the server which languages it knows…");
    const answer = await languages(settings);
    if (answer.failure) {
        report(`No language list (${answer.failure.kind}: ${answer.failure.detail}). `
            + "The menus keep what is saved.", true);
        return;
    }

    offered = answer.languages;
    fill(settings);
    report(`The server knows ${offered.length} languages.`);
}

async function save(event) {
    event.preventDefault();

    const settings = fromForm();
    const problems = problemsWith(settings);
    if (problems.length > 0) {
        report(problems.join(" "), true);
        return;
    }

    // The permission is granted only from a user gesture, so it is what this
    // click awaits first.
    const origin = originOf(settings.url);
    let granted = false;
    let refusal = null;
    try {
        granted = await browser.permissions.request({ origins: [origin] });
    } catch (error) {
        refusal = String(error);
    }

    // The settings are kept whatever the answer: a request still goes through
    // on the server's own CORS headers, and a refused permission must not cost
    // the address that was just typed.
    await browser.storage.local.set(settings);
    fill(settings);

    if (refusal !== null) {
        report(`Saved. Access to ${origin} could not be asked for: ${refusal}`, true);
    } else if (granted) {
        report(`Saved, with access to ${origin}.`);
    } else {
        report(`Saved, but access to ${origin} was refused.`, true);
    }
}

// A settings page that fails to write must say so: the line it leaves on screen
// is the only thing telling the user whether the save happened.
form.addEventListener("submit", (event) => {
    save(event).catch((error) => report(`Nothing saved: ${error}`, true));
});
fields.language.addEventListener("change", applyVariantRule);

// On change and not on input: one request per keystroke would question a server
// whose address is still half typed.
fields.url.addEventListener("change", loadLanguages);

async function load() {
    fill(normalize(await browser.storage.local.get(null)));
    await loadLanguages();
}

load().catch((error) => report(`The settings could not be read: ${error}`, true));

/**
 * The panel a left click on an underlined word opens: the kind of mistake, the
 * language in force, the whole explanation, one button per replacement, and the
 * family's colour as a band down the edge of the card.
 *
 * Where it is allowed to live is the whole difficulty, and the answer is the
 * narrowest one the platform leaves. Nothing goes into `<body>`, not even an
 * attribute on one of its elements. One host element is created beside `<body>`,
 * as a child of `documentElement`, it carries a closed shadow root holding
 * everything, and it is taken out of the document again when the panel closes.
 * The send serializes the whole document with `OutputFormatted |
 * OutputNoFormattingInPre | OutputDisallowLineBreaking`
 * (`modules/MessageSend.sys.mjs`, `_getBodyFromEditor`), so `<head>` and the
 * siblings of `<body>` go out with the rest, but never a shadow root's content,
 * because `AllowCrossShadowBoundary` appears nowhere in the shipped tree. The
 * worst a message could ever carry is therefore one empty tag, and it carries
 * nothing at all as long as the panel is closed.
 *
 * It is a compose script of its own, loaded before compose.js, because a compose
 * script cannot be imported: kept inside compose.js this logic would be out of
 * reach of the tests, which load this file alone. A compose script has no module
 * system either, so globalThis is the only channel to compose.js.
 */

// The compose scripts run in one shared global scope, so a top level
// declaration here would collide with the same name in another of them and
// kill it at instantiation. Nothing leaks out but globalThis.olcPanel.
(() => {
    /**
     * The host's tag name.
     *
     * Hyphenated because `attachShadow` accepts a valid custom element name or
     * one of a fixed list of HTML elements, and nothing else. Unknown to the
     * platform, so it is laid out and styled by this file alone, and the one tag
     * that could ever be seen says where it came from.
     */
    const HOST_TAG = "olc-panel";

    // Room for the wavy underline between the word and the panel, without the
    // panel drifting away from what it explains.
    const MARGIN = 6;

    // The same cap as the context menu's, which `src/menu.js` declares as
    // MAX_REPLACEMENTS. The value is written twice because a compose script can
    // import nothing, the way `src/compose.css` carries its own copy of the
    // underline colour. LanguageTool orders its replacements by likelihood, so
    // what is cut is what was least likely anyway.
    const MAX_REPLACEMENTS = 5;

    /**
     * The panel's whole appearance, inside the shadow root so that nothing of it
     * can reach the message being written, and nothing of the message can reach
     * it.
     *
     * The system colours and `color-scheme` are how the options page follows the
     * light or dark preference, and the panel is interface rather than text, so
     * it takes the platform's interface font for the same reason.
     */
    const STYLE = `
:host {
    position: fixed;
    /* Measured before it is placed, so it starts at a known corner with the
       whole viewport to grow into. */
    left: 0;
    top: 0;
    width: max-content;
    max-width: 24em;
    color-scheme: light dark;
    font: message-box;
    text-align: start;
}

.card {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    padding: 0.6em 0.8em;
    color: CanvasText;
    background: Canvas;
    border: 1px solid ButtonBorder;
    /* The family's colour is set on this side per match, so no colour is named
       here: a match the event page painted none on keeps the hairline's own,
       where a band of CanvasText would state a family in the colour of plain
       text. */
    border-inline-start-width: 5px;
    border-radius: 4px;
    /* The radius curves a band this wide away over its whole width, and both
       ends of it then read as chipped rather than as drawn. */
    border-start-start-radius: 0;
    border-end-start-radius: 0;
    box-shadow: 0 2px 8px rgb(0 0 0 / 30%);
}

.kind {
    display: flex;
    align-items: center;
    gap: 0.4em;
    margin: 0;
    font-weight: bold;
}

.language {
    font-weight: normal;
    color: GrayText;
}

.message {
    margin: 0;
}

.fixes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4em;
}

button {
    font: inherit;
    padding: 0.2em 0.5em;
    color: ButtonText;
    background: ButtonFace;
    border: 1px solid ButtonBorder;
    border-radius: 3px;
    cursor: pointer;
}

button:hover {
    color: SelectedItemText;
    background: SelectedItem;
}

/* A replacement that deletes shows the text it takes away, and the line through
   it is what says the text goes. */
button.struck {
    text-decoration: line-through;
}

@media (prefers-color-scheme: dark) {
    /* The one value the panel picks itself, so it is also the one that needs its
       own shade to be seen against a dark canvas. */
    .card {
        box-shadow: 0 2px 8px rgb(0 0 0 / 60%);
    }
}
`;

    /**
     * What closes the panel, and in which phase.
     *
     * A press rather than a click, so that the click which opens the panel is not
     * also the click which closes it. Scroll is watched in the capture phase
     * because a scroll inside the message does not bubble, and the panel is
     * placed in client coordinates, so it no longer sits at the word once
     * anything has scrolled.
     */
    const DISMISS = [["mousedown", false], ["keydown", false], ["scroll", true]];

    /** The host element while the panel is open, and null the rest of the time. */
    let host = null;

    /**
     * Where the panel goes, in client coordinates.
     *
     * @param {{left: number, top: number, right: number, bottom: number}} anchor
     *        The box of the underlined word.
     * @param {{width: number, height: number}} panel
     * @param {{width: number, height: number}} viewport
     * @param {number} margin Gap between the word and the panel, in pixels.
     * @returns {{left: number, top: number}} `{left: 0, top: 0}` when any number
     *          the placement reads is not one: the panel is worth showing in a
     *          corner, and never worth an exception in a click handler.
     */
    function placement(anchor, panel, viewport, margin) {
        const read = [
            anchor?.left, anchor?.top, anchor?.bottom,
            panel?.width, panel?.height,
            viewport?.width, viewport?.height,
            margin,
        ];
        if (!read.every((value) => Number.isFinite(value))) {
            return { left: 0, top: 0 };
        }
        const [left, top, bottom, width, height, viewWidth, viewHeight, gap] = read;

        // Below the word, which is where the eye already is, and above it only
        // when below would fall out of the viewport. A word at the very bottom of
        // a window shorter than the panel leaves neither, and then the top of the
        // viewport is the only place it can be read at all.
        const under = bottom + gap;
        const placed = under + height > viewHeight ? top - gap - height : under;

        return {
            left: Math.max(0, Math.min(left, viewWidth - width)),
            top: Math.max(0, placed),
        };
    }

    /** Whether the panel is open. */
    const isOpen = () => host !== null;

    const dismiss = () => hide();

    /**
     * Opens the panel at one word, replacing the one already open if any.
     *
     * @param {object} options
     * @param {object} options.anchor The box of the underlined word, as
     *        `Range.getBoundingClientRect` gives it.
     * @param {object} options.match The match, painted with its `color`, its
     *        `label` and its `choices` by the event page.
     * @param {string|null} options.language The language in force.
     * @param {(value: string) => void} options.onApply Called with the
     *        replacement the user picked.
     */
    function show(options) {
        const { anchor, match, language, onApply } = options ?? {};
        hide();

        host = document.createElement(HOST_TAG);
        // The editor must have nowhere to put a caret in here.
        host.setAttribute("contenteditable", "false");

        const root = host.attachShadow({ mode: "closed" });
        const style = document.createElement("style");
        style.textContent = STYLE;
        root.append(style, card(match, language, onApply));

        // In the document first, because its size is what the placement needs and
        // only the layout knows it. Nothing is painted before this turn ends, so
        // the corner it is measured in is never seen.
        document.documentElement.appendChild(host);
        const box = host.getBoundingClientRect();
        const spot = placement(
            anchor,
            { width: box.width, height: box.height },
            {
                width: document.documentElement.clientWidth,
                height: document.documentElement.clientHeight,
            },
            MARGIN,
        );
        host.style.left = `${spot.left}px`;
        host.style.top = `${spot.top}px`;

        for (const [type, capture] of DISMISS) {
            document.addEventListener(type, dismiss, capture);
        }
    }

    /** Closes the panel and takes its host out of the document. */
    function hide() {
        if (host === null) {
            return;
        }

        for (const [type, capture] of DISMISS) {
            document.removeEventListener(type, dismiss, capture);
        }
        host.remove();
        host = null;
    }

    function card(match, language, onApply) {
        const element = document.createElement("div");
        element.className = "card";
        // The family, said once and by the colour alone. Anything that is not a
        // colour writes no declaration, and the band stays the hairline it is
        // widened from.
        element.style.borderInlineStartColor = textOf(match?.color);

        // A click in the panel is not a click in the text being written, and
        // compose.js reads the document's clicks as clicks in the text.
        element.addEventListener("click", (event) => event.stopPropagation());
        // The press is what would move the caret and take the focus off the
        // editor, and it is also what closes the panel from outside.
        element.addEventListener("mousedown", (event) => {
            event.preventDefault();
            event.stopPropagation();
        });

        element.append(kindLine(match, language));

        // In full and never shortened: reading the whole explanation is the
        // reason there is a panel and not only a menu.
        if (textOf(match?.message) !== "") {
            element.append(paragraph("message", match.message));
        }

        const fixes = replacements(match, onApply);
        if (fixes !== null) {
            element.append(fixes);
        }

        return element;
    }

    /** The kind of mistake and the language, on one line. */
    function kindLine(match, language) {
        const line = paragraph("kind", textOf(match?.label));

        // Nothing rather than a word for it: until the server has named the
        // language with enough confidence, none is in force.
        if (textOf(language) !== "") {
            line.append(paragraph("language", language, "span"));
        }

        return line;
    }

    /** The buttons, or null when the server offered no replacement. */
    function replacements(match, onApply) {
        // The count is of the buttons built, not of the replacements read, so
        // that the cap holds whatever the server sent.
        const buttons = [];
        for (const choice of choicesOf(match)) {
            if (buttons.length >= MAX_REPLACEMENTS) {
                break;
            }
            // The event page leaves a hole where a replacement was no text at
            // all, and a hole is neither shown nor written.
            if (typeof choice?.value !== "string") {
                continue;
            }
            const button = document.createElement("button");
            // What the replacement does, which for a deletion or a whitespace is
            // all there is to see. The value is what gets written, never this.
            button.textContent = choice.text;
            if (choice.struck) {
                button.className = "struck";
            }
            button.addEventListener("click", () => onApply(choice.value));
            buttons.push(button);
        }

        if (buttons.length === 0) {
            return null;
        }
        const element = document.createElement("div");
        element.className = "fixes";
        element.append(...buttons);
        return element;
    }

    /**
     * The replacements as the event page painted them, and the raw ones when it
     * painted none: a mistake the server offered a fix for must not open a panel
     * with no button under it.
     */
    function choicesOf(match) {
        if (Array.isArray(match?.choices)) {
            return match.choices;
        }
        const offered = Array.isArray(match?.replacements) ? match.replacements : [];
        return offered.map((value) => ({ value, text: value, struck: false }));
    }

    function paragraph(className, content, tag = "p") {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = content;
        return element;
    }

    /** Anything that is not a text is none. */
    const textOf = (value) => (typeof value === "string" ? value : "");

    globalThis.olcPanel = { placement, show, hide, isOpen };
})();

/**
 * The shapes the packaged icons are drawn in, and the files they are written as.
 *
 * Two families come from here. The five `src/icons/swatch-<hex>.png` an entry of the
 * button's menu carries, and the two `src/icons/icon-*.svg` the toolbar button wears
 * for a state that is not a count. `test/swatch.test.mjs` and
 * `test/button.test.mjs` draw every one of them again and hold the committed
 * file equal to this shape. So the colours keep their one home in `SWATCHES`,
 * the names keep theirs in `src/background/button.js`, the shapes keep theirs here, and a
 * sixth colour or a third state is drawn from here rather than redrawn by hand
 * into something else. A helper and not a test, like `helpers.mjs` and
 * `compose-helpers.mjs`, and the runner collects `*.test.mjs` alone.
 *
 * The flag is explicit because the run overwrites packaged files, where
 * importing this file is what the tests do on every run:
 *
 *   node test/icons.mjs --draw
 *
 * A swatch is a rounded square standing off the edges, because a fill bled to
 * all four sides reads as a block of colour and not as a mark, and because the
 * rounding needs that room to be seen at all. The colour sits on every pixel
 * whatever its alpha and the alpha alone carries the silhouette, so the file
 * holds one colour and one shape, each of them checkable without the other.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { ALERT_ICON, BUSY_ICON } from "../src/background/button.js";
import { SWATCHES, swatchFor } from "../src/background/swatch.js";
import { srcDir } from "./helpers.mjs";

/** The gutter a menu icon is drawn in, and the size the menu entries declare. */
export const GLYPH_SIZE = 16;

/** How far the square stands off every edge, which is the room the rounding takes. */
const INSET = 2;

/** The radius the four corners are turned on. */
const RADIUS = 3;

/** Samples per axis and per pixel, which is what the corners are smoothed with. */
const SAMPLES = 4;

/** The eight bytes every PNG file opens with. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Truecolour with an alpha channel, the alpha being the whole of the shape. */
const COLOR_TYPE_RGBA = 6;

/**
 * The red the ring is drawn in.
 *
 * Written in, as `WAIT_COLOR` is, because Thunderbird hands a WebExtension
 * toolbar icon no context properties: `currentColor` and `context-fill` would
 * resolve to nothing there. It stays above 3:1 against both the light and the
 * dark toolbar, so one file serves both, and it is the logo's own red so that a
 * pass that failed still reads as this extension and not as something else that
 * turned up in the toolbar. `src/icons/icon.svg` is hand written and spells the
 * same value, which `test/button.test.mjs` holds the two to.
 */
export const RING_COLOR = "#e74c3c";

/**
 * The teal the wait is drawn in, where the logo and the alert are red.
 *
 * The divergence is the whole point: red is the colour that asks for attention,
 * and a check merely running asks for none. Carrying the same value as the style
 * swatch of `src/background/swatch.js` is a coincidence and not a link, one
 * standing for a mistake of style and the other for work under way, and nothing
 * is to hold the two equal.
 *
 * It is also the one product colour that survived being measured. Of the five
 * `SWATCHES` carries, it alone clears 3:1 on a light toolbar and on a dark one:
 * 3.12:1 on the light `#f9f9fb`, 4.32:1 on the dark `#2b2a33`, and 3.06:1 on the
 * worst mid grey between them. The blue, the red and the violet all fall to
 * about 2.5:1 on a dark bar, and the orange holds on the two real bars alone. So
 * a colour reached for from that palette to paint something in the chrome is a
 * colour to measure first, whatever it is doing in the message body.
 */
export const WAIT_COLOR = "#16a085";

/**
 * The type size the ring holds.
 *
 * The ring is twelve and a half pixels across inside its stroke, which the
 * exclamation mark fills at eleven and is read at a glance in a toolbar.
 */
const RING_FONT_SIZE = 11;

/** The one mark a ring still holds, a pass that never reached the server. */
const ALERT_MARK = "!";

/**
 * What makes the wait turn, which is a CSS animation inside the file, the way
 * Thunderbird animates its own spinner
 * (chrome://messenger/skin/icons/spinning.svg).
 *
 * The wait lives in the icon because nothing can draw a border, a halo or a
 * motion around the button itself: the extension owns these 18 by 18 pixels and
 * nothing else. That such a file really animates in this position, a toolbar
 * action icon, had no precedent in the shipped build and was watched on the
 * button to be sure of it.
 *
 * `transform-box` reads as noise and is not. The centre is given in user units,
 * and those are the view box's units only where the box is named. Left to the
 * element's own, the arc measures its 8 by 8 from its own corner and turns
 * around a point that is nowhere near the middle of the icon. Nothing rasterised
 * catches that either, a still renderer running no CSS at all, so it would show
 * for the first time on the button.
 */
const TURNING = `
    <style>
        @keyframes olcTurn {
            to { transform: rotate(360deg); }
        }
        #comet {
            animation: olcTurn 1.4s linear infinite;
            transform-box: view-box;
            transform-origin: 8px 8px;
        }
    </style>`;

/**
 * The head of the comet and the two steps of its tail, as the offset each one
 * starts at, how opaque it is and how its end is cut.
 *
 * The offsets are never negative, SVG 1.1 having called a negative
 * `stroke-dashoffset` an error.
 */
const TRAIL = [
    ["24.00", "0.3", "butt"],
    ["29.28", "0.6", "butt"],
    ["0.00", "1.0", "round"],
];

/** The note a drawn file carries, its shape being decided somewhere else. */
const PROVENANCE = `    <!-- Drawn by test/icons.mjs, which holds the shape and its reasons. Change
         it there and run it again, never this file by hand. -->`;

/**
 * The one line of text a ring holds.
 *
 * A generic family and no `@font-face`, because an SVG used as an image reaches
 * the system fonts and is not proven to load a font file, which is the very
 * reason the size has to clear the widest of them. The stroke is turned off
 * because a ring declares one on the root for its circle and a text inherits it.
 */
function glyph(mark) {
    return `<text x="8" y="8" font-family="sans-serif" font-size="${RING_FONT_SIZE}" font-weight="bold" fill="${RING_COLOR}" stroke="none" text-anchor="middle" dominant-baseline="central">${mark}</text>`;
}

/**
 * The whole SVG file of the ring holding one mark.
 *
 * @param {string} mark What sits at the centre of the ring.
 * @returns {string} Ready to write beside the rest of the extension.
 */
export function ringIcon(mark) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" stroke="${RING_COLOR}">
${PROVENANCE}
    <g id="ring">
        <circle cx="8" cy="8" r="7" fill="none" stroke-width="1.5"/>
        ${glyph(mark)}
    </g>
</svg>
`;
}

/** One arc of the comet, the three of them differing in nothing but a `TRAIL` row. */
function arc([offset, opacity, cap]) {
    return `<circle cx="8" cy="8" r="5.5" fill="none" stroke="${WAIT_COLOR}" stroke-width="2.0" stroke-linecap="${cap}" stroke-dasharray="5.53 29.03" stroke-dashoffset="${offset}" opacity="${opacity}"/>`;
}

/**
 * The whole SVG file of the wait.
 *
 * A faint ring holds the silhouette, so the button is never a gap in the toolbar
 * while the arc is on the far side of it. Turning is what the wait is drawn as
 * because a turn reports nothing: it has no first frame and no last, where a
 * mark that grew or settled would read as a result. The three steps of opacity
 * give the arc a direction of travel, which is what tells turning from shaking.
 *
 * @returns {string} Ready to write beside the rest of the extension.
 */
export function cometIcon() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
${PROVENANCE}${TURNING}
    <circle cx="8" cy="8" r="5.5" fill="none" stroke="${WAIT_COLOR}" stroke-width="2.0" opacity=".22"/>
    <g id="comet">
${TRAIL.map((step) => `        ${arc(step)}`).join("\n")}
    </g>
</svg>
`;
}

/**
 * Every pixel of the swatch of one colour, row by row and run together.
 *
 * @param {string} color `#rrggbb`, as `SWATCHES` declares one.
 * @returns {number[][]} One pixel per entry, each of them red, green, blue and
 *          alpha, in the order a PNG raster reads them.
 */
export function swatchPixels(color) {
    const rgb = [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16));

    const pixels = [];
    for (let row = 0; row < GLYPH_SIZE; row += 1) {
        for (let column = 0; column < GLYPH_SIZE; column += 1) {
            pixels.push([...rgb, Math.round(coverage(column, row) * 255)]);
        }
    }
    return pixels;
}

/**
 * The whole PNG file of the swatch of one colour.
 *
 * @param {string} color `#rrggbb`, as `SWATCHES` declares one.
 * @returns {Buffer} Ready to write beside the rest of the extension.
 */
export function swatchFile(color) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(GLYPH_SIZE, 0);
    header.writeUInt32BE(GLYPH_SIZE, 4);
    header[8] = 8;
    header[9] = COLOR_TYPE_RGBA;
    // The last three stay at zero: deflate, the one filter method there is, and
    // no interlacing.

    const pixels = swatchPixels(color);
    const raster = [];
    for (let row = 0; row < GLYPH_SIZE; row += 1) {
        // The filter byte, which says the row was left exactly as it stands.
        // Filtering compresses better, and it costs the test a decoder of the
        // five filters for a saving counted in tens of bytes.
        raster.push(0, ...pixels.slice(row * GLYPH_SIZE, (row + 1) * GLYPH_SIZE).flat());
    }

    return Buffer.concat([
        SIGNATURE,
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(Buffer.from(raster), { level: 9 })),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

/**
 * How much of one pixel the rounded square covers, from none of it to all.
 *
 * Sampled on a grid rather than solved: the area of a pixel cut by an arc is
 * not worth an exact answer at sixteen pixels square, and the eye cannot tell
 * the two apart there.
 */
function coverage(column, row) {
    let inside = 0;
    for (let down = 0; down < SAMPLES; down += 1) {
        for (let across = 0; across < SAMPLES; across += 1) {
            if (covers(column + (across + 0.5) / SAMPLES, row + (down + 0.5) / SAMPLES)) {
                inside += 1;
            }
        }
    }
    return inside / (SAMPLES * SAMPLES);
}

/** Whether one point falls inside the rounded square. */
function covers(x, y) {
    // The nearest centre of curvature. On a straight edge it is the point's own
    // coordinate, which leaves the distance measured across that edge alone, and
    // past a corner it is that corner's centre, which turns the test into the
    // circle's.
    const cx = between(x);
    const cy = between(y);
    return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2;
}

const between = (value) =>
    Math.min(Math.max(value, INSET + RADIUS), GLYPH_SIZE - INSET - RADIUS);

/** One length-type-data-CRC chunk, which is what a PNG is a chain of. */
function chunk(type, data) {
    const framed = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(framed));

    return Buffer.concat([length, framed, checksum]);
}

if (process.argv.includes("--draw")) {
    for (const color of Object.values(SWATCHES)) {
        const name = swatchFor(color);
        const file = swatchFile(color);

        writeFileSync(join(srcDir, name), file);
        console.log(`OK ${name} (${file.length} bytes)`);
    }

    for (const [name, file] of [[ALERT_ICON, ringIcon(ALERT_MARK)], [BUSY_ICON, cometIcon()]]) {
        writeFileSync(join(srcDir, name), file);
        console.log(`OK ${name} (${Buffer.byteLength(file)} bytes)`);
    }
}

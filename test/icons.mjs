/**
 * The shape a swatch is drawn in, and the PNG file one is written as.
 *
 * The five `src/swatch-<hex>.png` files come from here, and
 * `test/swatch.test.mjs` draws every one of them again to hold the committed
 * file equal to this shape. So the colours keep their one home in `SWATCHES`,
 * the shape keeps its one home here, and a sixth family is drawn from here
 * rather than redrawn by hand into something else. A helper and not a test,
 * like `helpers.mjs` and `compose-helpers.mjs`, and the runner collects
 * `*.test.mjs` alone.
 *
 * The flag is explicit because the run overwrites packaged files, where
 * importing this file is what the test does on every run:
 *
 *   node test/icons.mjs --draw
 *
 * A rounded square standing off the edges, because a fill bled to all four
 * sides reads as a block of colour and not as a mark, and because the rounding
 * needs that room to be seen at all. The colour sits on every pixel whatever
 * its alpha and the alpha alone carries the silhouette, so the file holds one
 * colour and one shape, each of them checkable without the other.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

import { SWATCHES, swatchFor } from "../src/swatch.js";

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

/** Where the packaged icons sit, which is the directory the extension is built from. */
const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

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
}

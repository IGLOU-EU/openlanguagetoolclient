/**
 * Text extraction for the compose body: flattening it, skipping what the user
 * did not write and the code they did, cutting it into the blocks a check is
 * remembered by, dropping the ones fenced code or a plain text signature
 * carries, grouping those blocks into what one request carries, mapping an
 * offset to the DOM and a position in the DOM back to an offset, finding the
 * error or the block a position falls in, and moving a block's errors when a
 * correction is written over part of it. Pure logic, no DOM mutation, no
 * network, no Thunderbird API.
 *
 * It is a compose script of its own, loaded before compose.js, because a
 * compose script cannot be imported: kept inside compose.js this logic would
 * be out of reach of the tests, which load this file alone. A compose script
 * has no module system either, so globalThis is the only channel to
 * compose.js.
 *
 * The event page never loads this file. One loaded in both contexts kills the
 * compose script on its very first line.
 */

// The compose scripts run in one shared global scope, so a top level
// declaration here would collide with the same name in another of them and
// kill it at instantiation. Nothing leaks out but globalThis.olcBody.
(() => {
    // Block boundaries. Without a separator, two neighboring paragraphs reach the
    // server glued into a single word, and it sees an error that does not exist.
    const BLOCK_TAGS = new Set([
        "ADDRESS", "BLOCKQUOTE", "BR", "DD", "DIV", "DL", "DT", "H1", "H2", "H3",
        "H4", "H5", "H6", "HR", "LI", "OL", "P", "PRE", "TABLE", "TD", "TH", "TR",
        "UL",
    ]);

    /**
     * True when the element and its whole subtree are not prose the user wrote.
     *
     * Thunderbird marks the quoted message, the line that introduces it and the
     * signature with these, and on a long thread they are most of the bytes. They
     * are also not the user's to correct.
     *
     * `<code>` and `<pre>` hold code, written by the Code text style and the
     * Preformat paragraph format. Code is not prose, is often not in the
     * language of the message, and draws false positives on nearly every line
     * of it. The plain text mode writes no `<pre>`, its lines being split by
     * `<br>` in the body itself, so this cannot swallow a plain text message.
     *
     * `_moz_quote` is the quote of a plain text composition, and it appears in no
     * HTML one, so no mode has to be known here. The line that introduces that
     * quote stays in the check: in this mode it carries no marker of any kind,
     * Thunderbird itself has no element to query for it and searches the body
     * text instead, so any rule here would be a guess. One flagged sentence per
     * reply is the price.
     *
     * It never throws on an element missing either accessor: the walk comes from a
     * live document, not from a shape this file controls.
     */
    function isSkipped(element) {
        if (element.nodeName === "CODE" || element.nodeName === "PRE") {
            return true;
        }
        const attribute = (name) => element.getAttribute?.(name) ?? null;
        if (element.nodeName === "BLOCKQUOTE" && attribute("type") === "cite") {
            return true;
        }
        // The value is the editor's business, the attribute being there is the
        // whole signal.
        if (attribute("_moz_quote") !== null) {
            return true;
        }
        const inClassList = (name) => element.classList?.contains?.(name) === true;
        return inClassList("moz-cite-prefix") || inClassList("moz-signature");
    }

    /**
     * Flattens the body and remembers where each piece comes from.
     *
     * The rendered text goes to the server as is: no normalization, or the
     * offsets it returns would be shifted. A skipped element still yields its
     * separator, so what surrounds it does not end up glued together.
     *
     * @returns {{text: string, segments: {node: Text, start: number, end: number}[]}}
     */
    function flatten(root) {
        const segments = [];
        let text = "";

        // The separator belongs to no node: no segment covers it.
        const separate = () => {
            if (text.length > 0 && !text.endsWith("\n")) {
                text += "\n";
            }
        };

        const visit = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.nodeValue.length > 0) {
                    segments.push({
                        node,
                        start: text.length,
                        end: text.length + node.nodeValue.length,
                    });
                    text += node.nodeValue;
                }
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return;
            }
            if (isSkipped(node)) {
                separate();
                return;
            }
            const block = BLOCK_TAGS.has(node.nodeName);
            if (block) {
                separate();
            }
            for (const child of node.childNodes) {
                visit(child);
            }
            if (block) {
                separate();
            }
        };

        visit(root);
        return { text, segments };
    }

    /**
     * Returns the node and local offset pair that corresponds to an offset in the
     * flattened text.
     *
     * The whole mapping between server offsets and the DOM goes through here.
     * Offsets are taken as UTF-16 code units, hence indexable as is in a
     * JavaScript string: should that finding ever differ, this is the only place
     * to fix.
     *
     * `edge` tips a segment boundary towards the left segment for the end of an
     * error, towards the right one for its start, so that the underline does not
     * jump to the neighboring block.
     */
    function locate(segments, offset, edge) {
        for (const segment of segments) {
            const inside = edge === "end"
                ? offset > segment.start && offset <= segment.end
                : offset >= segment.start && offset < segment.end;
            if (inside) {
                return { node: segment.node, offset: offset - segment.start };
            }
        }
        return null;
    }

    /**
     * The offset in the flattened text of a position given as a text node and an
     * offset inside that node.
     *
     * The inverse of `locate`, and the whole of what turns a click in the body
     * into something the server's offsets can be compared against.
     *
     * @returns {number|null} Null when the node belongs to no segment, and null
     * when the offset falls outside that node's own text.
     */
    function offsetOf(segments, node, offset) {
        for (const segment of segments) {
            if (segment.node !== node) {
                continue;
            }
            if (offset < 0 || offset > segment.end - segment.start) {
                return null;
            }
            return segment.start + offset;
        }

        return null;
    }

    /**
     * Cuts the flattened text into the blocks a result is remembered by.
     *
     * A piece holding nothing but whitespace has nothing to check, and dropping
     * it must not move the ones below it, hence the start each block carries.
     *
     * @returns {{text: string, start: number}[]}
     */
    function splitBlocks(text) {
        const blocks = [];
        let start = 0;

        for (const piece of text.split("\n")) {
            if (piece.trim() !== "") {
                blocks.push({ text: piece, start });
            }
            start += piece.length + "\n".length;
        }

        return blocks;
    }

    /**
     * The blocks up to the signature, that block and everything after it
     * dropped.
     *
     * In a plain text composition the signature is delimited by a line of two
     * hyphens and a space and by nothing else, which is how Thunderbird finds it
     * too. The first such line wins, because a signature quoted inside a reply
     * would otherwise cut the real one short. A user may legitimately write that
     * line in an HTML message, so the caller applies this only in the other mode.
     *
     * The line is compared as it stands and never trimmed. Nothing says a block
     * was dropped, so a rule loose enough to take a bare `--` a user typed for
     * their own reasons would silently stop checking the rest of the message.
     * Missing a separator this editor never writes is the lesser failure.
     *
     * @param {{text: string, start: number}[]} blocks
     * @returns {{text: string, start: number}[]} A list of its own, holding the
     * blocks it was given and not copies. Empty for a list that is none.
     */
    function beforeSignature(blocks) {
        if (!Array.isArray(blocks)) {
            return [];
        }

        const signature = blocks.findIndex((block) => block?.text === "-- ");
        return blocks.slice(0, signature === -1 ? blocks.length : signature);
    }

    // The fences as CommonMark has them, so that what a Markdown reader shows as
    // code is what is left out. An opening line holding a backtick after its
    // fence is inline code there, and taking it for a fence would stop checking
    // the rest of the message. Spaces are allowed at either end, no-break ones
    // included, because that is what the HTML editor writes a typed space as.
    const OPENING_FENCE = /^\s*`{3,}[^`]*$/;
    const CLOSING_FENCE = /^\s*`{3,}\s*$/;

    /**
     * The blocks outside Markdown fenced code, both fences dropped with it.
     *
     * Code is not prose, is often not in the language of the message, and draws
     * false positives on nearly every line of it. A fence is a line the user
     * typed and no element marks it in either mode, hence a rule on blocks, as
     * for the plain text signature.
     *
     * A fence left open runs to the end of the blocks, as in CommonMark: ending
     * it anywhere else would be a guess. A closing fence carries nothing but
     * backticks, so a line naming a language inside a block is code.
     *
     * @param {{text: string, start: number}[]} blocks
     * @returns {{text: string, start: number}[]} A list of its own, holding the
     * blocks it was given and not copies. Empty for a list that is none.
     */
    function outsideFences(blocks) {
        if (!Array.isArray(blocks)) {
            return [];
        }

        const kept = [];
        let fenced = false;
        for (const block of blocks) {
            const line = block?.text ?? "";
            if (fenced ? CLOSING_FENCE.test(line) : OPENING_FENCE.test(line)) {
                fenced = !fenced;
            } else if (!fenced) {
                kept.push(block);
            }
        }

        return kept;
    }

    /**
     * Groups consecutive blocks into the chunks a request can carry, joined by
     * the same separator the flattened text uses.
     *
     * The language is decided on the whole text, which the server refuses past
     * a size, so that text leaves in pieces that fit. Each chunk keeps where
     * its blocks sit inside it, which is what lets one answer be filed block by
     * block afterwards.
     *
     * A block longer than the limit on its own becomes an oversized chunk of
     * one: dropping what the user wrote would be worse than letting the server
     * refuse it and name the limit.
     *
     * @param {{text: string, start: number}[]} blocks
     * @param {number} limit Longest chunk text, in characters.
     * @returns {{text: string, parts: {text: string, start: number}[]}[]}
     */
    function chunkBlocks(blocks, limit) {
        const chunks = [];

        for (const block of blocks) {
            const current = chunks[chunks.length - 1];
            const start = current === undefined ? 0 : current.text.length + "\n".length;

            if (current === undefined || start + block.text.length > limit) {
                chunks.push({ text: block.text, parts: [{ text: block.text, start: 0 }] });
                continue;
            }

            current.parts.push({ text: block.text, start });
            current.text += `\n${block.text}`;
        }

        return chunks;
    }

    /**
     * Files the matches of one chunk under the blocks that chunk was made of.
     *
     * Every part gets its entry, the ones without a single match included,
     * because a paragraph found clean is a paragraph never asked about again.
     *
     * A match straddling two parts, or falling on the separator between them,
     * belongs to neither and is dropped: attached to either one it would
     * underline text it does not cover. The returned matches are copies, the
     * caller's own are left alone.
     *
     * @param {{offset: number, length: number}[]} matches Offsets relative to
     *                                                     the chunk text.
     * @param {{text: string, start: number}[]} parts
     * @returns {{text: string, matches: object[]}[]}
     */
    function splitMatches(matches, parts) {
        return parts.map((part) => {
            const end = part.start + part.text.length;
            const inside = matches.filter(
                (match) => match.offset >= part.start && match.offset + match.length <= end,
            );
            return {
                text: part.text,
                matches: inside.map((match) => ({ ...match, offset: match.offset - part.start })),
            };
        });
    }

    /**
     * The texts of the blocks the cache holds no result for, in order of first
     * appearance and without a repeat: two identical paragraphs are worth one
     * request.
     *
     * @param {{text: string, start: number}[]} blocks
     * @param {Map<string, object[]>} cache Matches per block text, their
     *                                      offsets relative to that block.
     * @returns {string[]}
     */
    function missingBlocks(blocks, cache) {
        const missing = new Set();

        for (const block of blocks) {
            if (!cache.has(block.text)) {
                missing.add(block.text);
            }
        }

        return [...missing];
    }

    /**
     * The matches the cache holds for these blocks, each moved to where its
     * block sits in the flattened text.
     *
     * A block with no result yields nothing, so it stays free of underline
     * until its own answer arrives. The cached matches are copied rather than
     * moved, because the same block lands at another offset as soon as anything
     * above it changes.
     *
     * `fallback` is asked about a block the cache does not hold, and only then,
     * so an answer always wins over a guess made while waiting for one. A block
     * neither of them holds still yields nothing.
     *
     * @param {Map<string, object[]>} [fallback]
     */
    function matchesForBlocks(blocks, cache, fallback) {
        const matches = [];

        for (const block of blocks) {
            const known = cache.has(block.text)
                ? cache.get(block.text)
                : fallback?.get(block.text);
            for (const match of known ?? []) {
                matches.push({ ...match, offset: match.offset + block.start });
            }
        }

        return matches;
    }

    /**
     * The first match whose span covers an offset.
     *
     * The span stops before `match.offset + match.length`, so a position at the
     * very end of an error is outside it: that is where the next word begins,
     * and a right click there is not a right click on the error.
     *
     * @returns {object|null} Null when no match covers the offset, and null for
     * an offset that is not a finite number.
     */
    function matchAt(matches, offset) {
        if (!Number.isFinite(offset)) {
            return null;
        }

        for (const match of matches) {
            if (offset >= match.offset && offset < match.offset + match.length) {
                return match;
            }
        }

        return null;
    }

    /**
     * The block whose span covers an offset.
     *
     * The span stops before `block.start + block.text.length`, where the
     * separator between two blocks sits: it belongs to neither of them.
     *
     * @returns {object|null} The block itself and not a copy, so the caller
     * reads the very text the cache keys it by. Null when no block covers the
     * offset, and null for an offset that is not a finite number.
     */
    function blockAt(blocks, offset) {
        if (!Number.isFinite(offset)) {
            return null;
        }

        for (const block of blocks) {
            if (offset >= block.start && offset < block.start + block.text.length) {
                return block;
            }
        }

        return null;
    }

    /**
     * One block's matches after a span of it was replaced by another text.
     *
     * A correction changes the block's text, so nothing is remembered about it
     * any more and the mistakes it still holds would go unmarked until the
     * server has answered about the new text. What the replacement does to them
     * is known without asking anyone: everything after it moves by the
     * difference in length.
     *
     * A match touching the replaced span in any way is dropped, the corrected
     * one included. The text it was measured against is gone, so its offset and
     * its length describe nothing, and its replacements would rewrite a word
     * the user did not ask about.
     *
     * @param {{offset: number, length: number}[]} matches Offsets relative to
     *                                                     the block.
     * @param {number} offset Start of the replaced span, relative to the block.
     * @param {number} length Length of the replaced span.
     * @param {string} value What was written in its place.
     * @returns {object[]} Copies, in the order they came in. Empty when the
     * arguments describe no replacement: a list that is none, a span that is
     * not a pair of positive numbers, or a value that is not a text.
     */
    function afterReplacement(matches, offset, length, value) {
        if (!Array.isArray(matches) || !Number.isFinite(offset) || offset < 0
            || !Number.isFinite(length) || length < 0 || typeof value !== "string") {
            return [];
        }

        const shift = value.length - length;
        const kept = [];

        for (const match of matches) {
            // Read through the optional chain so an entry that is no match at
            // all falls out instead of taking the whole adjustment down with it.
            const start = match?.offset;
            if (start + match?.length <= offset) {
                kept.push({ ...match });
            } else if (start >= offset + length) {
                kept.push({ ...match, offset: start + shift });
            }
        }

        return kept;
    }

    /**
     * The cache reduced to the results of the given blocks.
     *
     * Every edit of a paragraph leaves its previous text behind, so without
     * this the cache would grow with the session instead of staying the size of
     * the message being written.
     *
     * @returns {Map<string, object[]>}
     */
    function prune(cache, blocks) {
        const kept = new Map();

        for (const block of blocks) {
            if (cache.has(block.text)) {
                kept.set(block.text, cache.get(block.text));
            }
        }

        return kept;
    }

    globalThis.olcBody = {
        BLOCK_TAGS,
        isSkipped,
        flatten,
        locate,
        offsetOf,
        splitBlocks,
        beforeSignature,
        outsideFences,
        chunkBlocks,
        splitMatches,
        missingBlocks,
        matchesForBlocks,
        matchAt,
        blockAt,
        afterReplacement,
        prune,
    };
})();

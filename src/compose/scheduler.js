/**
 * Puts the check on the rhythm of writing: one pass once the keys have stopped
 * moving, and never two passes at once.
 *
 * Two at once is the part that matters. A pass ends by pruning the cache
 * against the blocks it saw, so an older pass finishing last would drop the
 * entries a newer one has just filed.
 *
 * It is a compose script of its own, loaded before compose.js, because a compose
 * script cannot be imported: kept inside compose.js this logic would be out of
 * reach of the tests, which load this file alone. A compose script has no module
 * system either, so globalThis is the only channel to compose.js.
 */

// The compose scripts run in one shared global scope, so a top level
// declaration here would collide with the same name in compose.js and kill it
// at instantiation. Nothing leaks out but globalThis.olcSchedule.
(() => {
    /**
     * Delays `run` until the requests stop coming, and keeps one call of it in
     * flight at most.
     *
     * The timer functions are taken as arguments rather than from the global, so
     * that a test owns the clock instead of waiting for it.
     *
     * @param {object} options
     * @param {() => (void|Promise<void>)} options.run
     * @param {number} options.delay Milliseconds of quiet before a run.
     * @param {(callback: () => void, ms: number) => *} options.setTimer
     * @param {(handle: *) => void} options.clearTimer
     * @returns {{request: () => void, runNow: () => void}}
     */
    function createScheduler({ run, delay, setTimer, clearTimer }) {
        let timer = null;
        let running = false;
        let again = false;

        const cancel = () => {
            if (timer !== null) {
                clearTimer(timer);
                timer = null;
            }
        };

        /**
         * One run after the other, the requests that arrived during a run being
         * worth a single further one: they all ask for the same thing, the state
         * of the body once it stops moving.
         */
        const loop = async () => {
            running = true;
            do {
                again = false;
                try {
                    await run();
                } catch {
                    // A run that failed must not take the ones after it down,
                    // and the caller reports its own failures.
                }
            } while (again);
            running = false;
        };

        const fire = () => {
            if (running) {
                again = true;
                return;
            }
            loop();
        };

        return {
            request: () => {
                cancel();
                timer = setTimer(() => {
                    timer = null;
                    fire();
                }, delay);
            },
            runNow: () => {
                cancel();
                fire();
            },
        };
    }

    globalThis.olcSchedule = { createScheduler };
})();

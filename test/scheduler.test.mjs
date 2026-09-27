/**
 * The contract of src/scheduler.js: a check runs once the writing has stopped,
 * one at a time, and never before the one in flight has settled.
 *
 * No test here waits. The clock is a pair of fakes the test drives by hand, and
 * `run` settles when the test says so, so the timing this file is about is
 * decided by the test and not by the machine it runs on.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadScheduler } from "./compose-helpers.mjs";

const { api: olcSchedule, publishedGlobals } = loadScheduler();
const { createScheduler } = olcSchedule;

/** Any value does, the scheduler only passes it on to setTimer. */
const DELAY = 1000;

// The scheduler's continuations are microtasks, and how many links its promise
// chain holds is its own business, not the contract's. Draining a generous
// number of turns settles any chain a resolution or a rejection goes through.
const SETTLE_TURNS = 50;

/** Lets the scheduler finish everything it queued on the current run. */
async function settle() {
    for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
        await Promise.resolve();
    }
    // Node reports an unhandled rejection only once the microtask queue is
    // empty, so one turn of the event loop is what makes an escaped one
    // visible. It is a turn, not a delay: nothing here waits on a clock.
    await new Promise(setImmediate);
}

/**
 * The clock the test owns.
 *
 * Every timer armed is kept with its delay, and `clearTimer` records the handle
 * it was handed. What the contract is about is which timer was cancelled and
 * when, so nothing here makes a callback unreachable by itself.
 */
function clock() {
    const armed = [];
    const cleared = [];

    return {
        armed,
        cleared,
        setTimer(callback, ms) {
            // An object handle, so cancelling the wrong timer cannot pass for
            // the right one on two equal numbers.
            const handle = { timer: armed.length };
            armed.push({ handle, callback, ms });
            return handle;
        },
        clearTimer(handle) {
            cleared.push(handle);
        },
        /** True when this exact timer's handle went to clearTimer. */
        cancelled(index) {
            return cleared.includes(armed[index].handle);
        },
        /** The delay of every timer armed so far, in order. */
        delays() {
            return armed.map((timer) => timer.ms);
        },
        /** Runs a timer's callback, as the platform would at the end of its delay. */
        fire(index = armed.length - 1) {
            const timer = armed[index];
            assert.ok(timer, "no timer was armed, so nothing could fire");
            timer.callback();
        },
    };
}

/**
 * The run the test settles by hand.
 *
 * One pending promise per call, in call order, so a test can settle the first
 * run and watch what the scheduler does with the firings piled up behind it.
 */
function runner() {
    const calls = [];

    return {
        calls,
        run(...args) {
            return new Promise((resolve, reject) => {
                calls.push({ args, resolve, reject });
            });
        },
        /** How many times the scheduler called run. */
        count() {
            return calls.length;
        },
        resolve(index = calls.length - 1) {
            calls[index].resolve();
        },
        reject(index = calls.length - 1) {
            calls[index].reject(new Error("check failed"));
        },
    };
}

/** A scheduler wired to a clock and a run the test drives. */
function schedulerOn(delay = DELAY) {
    const timers = clock();
    const check = runner();
    const scheduler = createScheduler({
        run: check.run,
        delay,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
    });
    return { timers, check, scheduler };
}

/**
 * The rejections Node reported as unhandled while the test ran.
 *
 * A swallowed rejection leaves no trace by definition, so the proof is taken the
 * other way round: an escaped one lands here, and the list stays empty. The
 * runner fails the test on such a rejection too, and this says in the test
 * itself that the swallowing is the contract and not a happy accident.
 */
function escapes(t) {
    const seen = [];
    const watch = (reason) => seen.push(String(reason));
    process.on("unhandledRejection", watch);
    t.after(() => process.off("unhandledRejection", watch));
    return seen;
}

test("the API is published on globalThis, and nothing else is", () => {
    assert.deepEqual(publishedGlobals, ["olcSchedule"]);
    assert.deepEqual(Object.keys(olcSchedule), ["createScheduler"]);
    assert.equal(typeof createScheduler, "function");
});

test("a scheduler offers request and runNow, and nothing else", () => {
    const { scheduler } = schedulerOn();

    assert.deepEqual(Object.keys(scheduler).sort(), ["request", "runNow"]);
    assert.equal(typeof scheduler.request, "function");
    assert.equal(typeof scheduler.runNow, "function");
});

test("request arms one timer for exactly the delay, and runs nothing by itself", async () => {
    const { timers, check, scheduler } = schedulerOn();

    scheduler.request();

    assert.deepEqual(timers.delays(), [DELAY]);
    assert.deepEqual(timers.cleared, []);
    assert.equal(check.count(), 0);

    // Nor does it run later: without a firing there is no run at all.
    await settle();

    assert.equal(check.count(), 0);
});

test("the delay is passed on as it was given, zero included", () => {
    const { timers, scheduler } = schedulerOn(0);

    scheduler.request();

    assert.deepEqual(timers.delays(), [0]);
});

test("a second request cancels the first timer and arms another", async () => {
    const { timers, check, scheduler } = schedulerOn();

    scheduler.request();
    scheduler.request();

    assert.equal(timers.armed.length, 2);
    assert.deepEqual(timers.cleared, [timers.armed[0].handle]);
    assert.equal(timers.cancelled(0), true);
    assert.equal(timers.cancelled(1), false);
    assert.deepEqual(timers.delays(), [DELAY, DELAY]);
    assert.equal(check.count(), 0);

    // Typing again pushes the check back: it happens once, late, not twice.
    timers.fire(1);
    await settle();

    assert.equal(check.count(), 1);
});

test("requesting ten times inside the delay window still yields a single run", async () => {
    const { timers, check, scheduler } = schedulerOn();

    for (let typed = 0; typed < 10; typed += 1) {
        scheduler.request();
    }

    assert.equal(timers.armed.length, 10);
    assert.deepEqual(
        timers.armed.map((timer, index) => timers.cancelled(index)),
        [true, true, true, true, true, true, true, true, true, false],
    );
    assert.equal(check.count(), 0);

    timers.fire();
    await settle();

    assert.equal(check.count(), 1);
});

test("firing the timer calls run once, with no argument", async () => {
    const { timers, check, scheduler } = schedulerOn();

    scheduler.request();
    timers.fire();
    await settle();

    assert.equal(check.count(), 1);
    assert.deepEqual(check.calls[0].args, []);
});

test("runNow cancels the pending timer and runs without going through the delay", async () => {
    const { timers, check, scheduler } = schedulerOn();

    scheduler.request();
    scheduler.runNow();
    await settle();

    // Nothing fired and no second timer was armed, so the run owes nothing to
    // the delay.
    assert.equal(check.count(), 1);
    assert.equal(timers.cancelled(0), true);
    assert.equal(timers.armed.length, 1);
});

test("runNow with nothing pending runs, and cancels nothing that does not exist", async () => {
    const { timers, check, scheduler } = schedulerOn();

    scheduler.runNow();
    await settle();

    assert.equal(check.count(), 1);
    assert.deepEqual(timers.cleared, []);
    assert.deepEqual(timers.armed, []);
});

test("a firing during a run in flight starts no second run", async () => {
    const { timers, check, scheduler } = schedulerOn();

    scheduler.request();
    timers.fire();
    await settle();

    assert.equal(check.count(), 1);

    // The writer types again and stops again while the first check is still out.
    scheduler.request();
    timers.fire();
    await settle();

    assert.equal(timers.armed.length, 2);
    assert.equal(check.count(), 1);
});

test("runNow during a run in flight starts no second run either", async () => {
    const { check, scheduler } = schedulerOn();

    scheduler.runNow();
    await settle();

    assert.equal(check.count(), 1);

    scheduler.runNow();
    await settle();

    assert.equal(check.count(), 1);

    check.resolve(0);
    await settle();

    assert.equal(check.count(), 2);
});

test("three firings during one run start exactly one more run, not three", async () => {
    const { timers, check, scheduler } = schedulerOn();

    scheduler.request();
    timers.fire();
    await settle();

    for (let typed = 0; typed < 3; typed += 1) {
        scheduler.request();
        timers.fire();
    }
    await settle();

    assert.equal(timers.armed.length, 4);
    assert.equal(check.count(), 1);

    check.resolve(0);
    await settle();

    assert.equal(check.count(), 2);
});

test("once the remembered run settles nothing follows it, until the next request", async () => {
    const { timers, check, scheduler } = schedulerOn();

    scheduler.request();
    timers.fire();
    await settle();

    for (let typed = 0; typed < 3; typed += 1) {
        scheduler.request();
        timers.fire();
    }
    check.resolve(0);
    await settle();

    assert.equal(check.count(), 2);

    check.resolve(1);
    await settle();

    assert.equal(check.count(), 2);

    // The writer types again: the scheduler is free and serves it.
    scheduler.request();
    timers.fire();
    await settle();

    assert.equal(check.count(), 3);
});

test("a run that rejects escapes nowhere, and the next request is still served", async (t) => {
    const escaped = escapes(t);
    const { timers, check, scheduler } = schedulerOn();

    scheduler.request();
    timers.fire();
    await settle();
    check.reject(0);
    await settle();

    assert.deepEqual(escaped, []);

    scheduler.request();
    timers.fire();
    await settle();

    assert.equal(check.count(), 2);
});

test("a run that rejects still lets the firing remembered behind it happen", async (t) => {
    const escaped = escapes(t);
    const { timers, check, scheduler } = schedulerOn();

    scheduler.request();
    timers.fire();
    await settle();

    scheduler.request();
    timers.fire();
    await settle();

    assert.equal(check.count(), 1);

    check.reject(0);
    await settle();

    assert.equal(check.count(), 2);
    assert.deepEqual(escaped, []);
});

test("a run that returns no promise settles like any other", async () => {
    // The contract says run may return a promise, not that it must.
    const timers = clock();
    let calls = 0;
    const scheduler = createScheduler({
        run: () => {
            calls += 1;
        },
        delay: DELAY,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
    });

    scheduler.request();
    timers.fire();
    await settle();

    assert.equal(calls, 1);

    scheduler.request();
    timers.fire();
    await settle();

    assert.equal(calls, 2);
});

test("two schedulers side by side share no state", async () => {
    const first = schedulerOn(500);
    const second = schedulerOn(1500);

    first.scheduler.request();

    assert.deepEqual(first.timers.delays(), [500]);
    assert.deepEqual(second.timers.delays(), []);

    first.timers.fire();
    await settle();

    assert.equal(first.check.count(), 1);
    assert.equal(second.check.count(), 0);

    // The first run is still in flight, and it gates its own scheduler alone.
    second.scheduler.request();
    second.timers.fire();
    await settle();

    assert.equal(second.check.count(), 1);
    assert.equal(first.check.count(), 1);

    second.check.resolve(0);
    await settle();

    assert.equal(first.check.count(), 1);
    assert.equal(second.check.count(), 1);
});

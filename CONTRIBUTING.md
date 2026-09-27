# Contributing to OpenLanguageToolClient

Thanks for the interest in the project. This is a free LanguageTool client for Thunderbird: a MailExtension in plain JavaScript, Manifest V3, zero dependencies, that underlines in the compose window what a LanguageTool server flags and offers the corrections in a panel opened by a click on the underlined word, the context menu being the second way to them. The goal is to keep it small, fast on long threads and specific to Thunderbird. [`README.md`](README.md) says why it exists and what it will never do.

> **🤖 Using an AI or an agentic tool?** Read [`AGENTS.md`](AGENTS.md) first. It holds the mandatory behaviour rules (no auto-commits, the LLM disclosure trailer, the architecture boundaries) and the map of which file owns which fact.

## Philosophy

- **KISS.** The simplest thing that answers the real need, never a demonstration of architecture. An abstraction is paid for when it has two concrete uses today. "In case" is a refusal, and a feature waits to be demanded by daily use before it is built.
- **No dependency.** No library, no npm package, no bundler, no privileged code: the web platform and the MailExtension API only. The central grievance against the official extension is its weight, and a dependency stack would ruin the reason this project exists.
- **Specific to Thunderbird.** A generic browser extension has to guess what it is looking at. This one knows it is a message, with quotes, a signature and two editing modes, and every simplification comes from that.
- **Silent on failure.** The extension never blocks writing or sending a message, whatever fails. A failure is reported, never thrown.
- **One source of truth.** A fact is declared once and referenced everywhere else. This file obeys it too: it says where things are, not what they are.

## Where to read

`README.md` says why the project exists and what it will never do. `AGENTS.md` § Where the truth lives maps every fact to its only home, launch command and test server included, and its rule 4 lists the architecture invariants with their reasons. The code carries its own reasons in its comments. There is nothing else: the owner's design notes stay outside the repository.

## Dev environment

You need Node, recent enough for `node:test` and the global `fetch`, and nothing else: there is nothing to install.

```bash
npm test      # the unit suite, replays captured server answers
./lancer.sh   # builds, installs in the dev profile, starts Thunderbird
```

`lancer.sh` is the only place where the launch command is written. Its header comment documents the modes and what to try once the compose window is open. It runs Thunderbird on the dedicated development profile `.tb-dev-profile`, ignored by git, and on nothing else. Never point it, or any other command, at your daily mail profile, and never read or copy credentials from one.

## Tests

- **TDD.** The test comes first. `src/languagetool.js` has no Thunderbird and no DOM access precisely so that it runs under Node.
- **A test proves a contract**, so it covers the failure modes too: the hostile response, the unreachable server, the invalid configuration, the boundaries, not only the path that works.
- **Fixtures are real captures.** Everything under `test/fixtures/` except `cases.json` and `capture.mjs` was written by `capture.mjs` from a real LanguageTool server. Never edit a fixture by hand: an invented response proves nothing. Change `cases.json`, the only home of the server URL, the texts and the parameters, then regenerate. The script's header says how.
- **Live tests stay off.** `test/live.test.mjs` reaches a real server and is skipped unless `LT_LIVE=1` is set. Its header gives the exact invocation.
- `npm test`, or `node --test test/*.test.mjs`, must pass before any commit. If something was failing before your change, say so, and never silently disable a test.

## Code conventions

- Everything is written in English, `README.fr.md` excepted: it is the French twin of `README.md`, which stays authoritative. French text found elsewhere is a leftover to translate, not a convention (`AGENTS.md` § English everywhere in the repo).
- A comment explains the **why**, the constraint or the reason, never how the code works. For a bug fix, a short pointer is enough.
- The architecture boundaries bind you as they bind an agent: `AGENTS.md` § Don't change the architecture without asking. The two that bite first: nothing is shared between `src/compose.js` and `src/background.js` (a common file kills the compose script), and a `Range` is never kept between two checks.

## Commits

Conventional Commits, in English, enforced by the [MOGH](https://github.com/IGLOU-EU/mogh) hooks the owner installs through git templates: `type(scope): subject`, lowercase subject, 80 characters at most, no trailing period, `!` before the colon for a breaking change. The hook prefixes the matching gitmoji, so the history reads `✨ feat(compose): ...`. Without the hooks, keep the format by hand. A body is written only when the subject cannot carry the reason. A `wip` commit cannot be pushed and blocks the next commit.

Every commit is signed off, with `git commit -s`. Any commit an LLM took part in also carries the `Assisted-by: LLM` trailer, right above the sign-off. The exact block, the reason and the pitfall with the hook are in `AGENTS.md` § Declare LLM assistance.

## Contribution cycle

1. Create a descriptive branch (`feat/quote-filter`, `fix/offset-after-emoji`).
2. Code following the conventions above, test first.
3. `npm test` must pass, whole suite green.
4. If you want to change one of the invariants listed in `AGENTS.md` rule 4 (the DOM and network split, the highlight mechanism, a dependency), **open an issue to discuss first**, no surprise merge requests.
5. Update the document that owns the fact in the same commit, and only that one.
6. Open a merge request with a description focused on **why**.

## License

The project is licensed under [GPL-3.0-or-later](LICENSE). By submitting a contribution you license it under the same terms.

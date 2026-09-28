# OpenLanguageToolClient

Version française : [README.fr.md](README.fr.md)

A free LanguageTool client for Thunderbird, built for Thunderbird and nothing else.

## Why

The official extension `languagetool-mailextension@languagetool.org` is in fact LanguageTool's universal browser extension, with a handful of Thunderbird lines grafted onto it. It ships about 150 website adapters (Gmail, Slack, Notion, Google Docs, ChatGPT...), an AI rephrasing layer, Matomo telemetry, A/B testing and a premium subscription mechanism. None of that makes sense in a mail client.

Four grievances motivate the rewrite.

1. **It is not free software.** Every chunk of the code is stamped `(C) Copyright LanguageTooler GmbH. All rights reserved.` No licence file, no public repository, no source map.
2. **Its configuration is locked down.** It cannot point at a public LanguageTool instance protected by authentication. A custom server goes through an enterprise policy file, not through the interface.
3. **It is slow on large messages.** It sends the whole body to the server, quotes included. On a thread of ten exchanges, that means resending tens of thousands of characters of quoted text to correct the three lines actually written.
4. **It is cluttered with commercial machinery.** Premium teasers, writing statistics, usage tracking, A/B tests.

A fifth point used to stand here, claiming that it no longer worked on Thunderbird 155. That was wrong, and the finding deserves to be set down where the error stood. The installed version (8.11.2, July 2024) does declare `strict_max_version: 130.*`, but Thunderbird 155 enables it by raising its compatibility to `157.*`. Its privileged part does import `resource://gre/modules/XPCOMUtils.jsm`, since removed from Gecko, but the import sits in a `try` with an empty `catch`, and `Services` is a global of modern privileged contexts anyway. The official extension works.

So this project does not fix a breakage. It replaces a tool that works with a free, lean and fast one. That is a choice, not a necessity, and the scope must remember it.

## What this project does

It underlines in the compose window the mistakes a LanguageTool server detects, offers the corrections in a panel opened by a click on the underlined word or in the context menu, and keeps quiet.

The underline is dotted, and it carries the colour of the kind of mistake, one colour for each of five families: spelling, grammar, typography, style and everything else. The same colours mark the panel, the entries of the context menu and the rows of the list, so a kind of mistake looks the same wherever it is shown.

The toolbar button says the state in its icon: the logo when there is nothing to report, a turning ring while a check runs, a ring with an exclamation mark when the server could not be reached, and a badge counting the mistakes found. Its menu holds the language and a fresh detection of it, a check of the whole message again, the picky mode, a switch that takes the message being written out of the checking, and the settings.

A window of its own lists every mistake of the message, opened by that menu's first entry or by a keyboard shortcut. One row per mistake, in the order of the text: the extract it sits in, what kind of mistake it is, how much of the text a correction would touch, the whole explanation and a button for each replacement. The arrow keys walk the list.

Besides the server and the language, the settings carry the thickness of the underline, in three levels, and how long the writing has to stop before a check runs, in seconds and bounded at both ends. A second keyboard shortcut asks for a check without waiting for that pause.

## What it will not do

AI rephrasing, synonyms, writing statistics, emoji suggestions, telemetry, A/B tests, accounts and subscriptions, support for websites outside Thunderbird.

Nothing is planned for the paid version of LanguageTool, keeps the official extension.

## License

GNU General Public License v3.0 or later. See `LICENSE`.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) holds the philosophy, the conventions, the test rules and the contribution cycle. AI assistants and agentic tools read [AGENTS.md](AGENTS.md) first, which sets the rules that bind them.

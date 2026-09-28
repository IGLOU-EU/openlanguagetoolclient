#!/usr/bin/env bash
# Builds the extension, installs it in the development profile and starts
# Thunderbird on it. The only place in the project where the launch command
# is written: the documents point here instead of copying it.
#
#   ./lancer.sh              integration run, with the interface
#   ./lancer.sh --headless   load check, without the interface
#
# The development profile, .tb-dev-profile, is not in the repository. It is
# an ordinary Thunderbird profile with a dummy account, an SMTP server pointed
# at a dead port so that an accidental send fails, and the LanguageTool
# server's private certificate authority trusted in its NSS store.
#
# Never touches the real mail profile.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$root/src"
profile="$root/.tb-dev-profile"
# The log lives in the profile, already outside the repository.
log="$profile/journal.log"
# Without an interface, nobody is there to close the window.
observation=60

headless=""
if [ "${1:-}" = "--headless" ]; then
    headless="yes"
elif [ -n "${1:-}" ]; then
    echo "unknown argument: $1" >&2
    exit 1
fi

if [ ! -d "$profile" ]; then
    echo "development profile missing: $profile" >&2
    exit 1
fi

# The version and the id live in the manifest only.
id="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['browser_specific_settings']['gecko']['id'])" "$src/manifest.json")"

mkdir -p "$profile/extensions"
xpi="$profile/extensions/$id.xpi"
rm -f "$xpi"
# All of src/ goes into the package: the file list is written nowhere, it is
# the folder's.
( cd "$src" && zip -qr "$xpi" . )
echo "extension installed: $xpi"

if [ -n "$headless" ]; then
    echo "loading without interface, observing for $observation s."
else
    cat <<'END'

  1. the first time, the options page opens: fill in the server address,
     pick a language, and save
  2. Write, or Ctrl+N, to open a compose window
  3. type a faulty French paragraph, then a second one
  4. stop typing: the check runs on its own after a second and a half
  5. the errors get a dotted underline in the colour of their kind, the
     toolbar button the count
  6. left click an underlined word for the panel, right click for the menu
  7. the button's menu lists the mistakes in a window of their own, one row
     each, walkable with the arrow keys
  8. the two shortcuts src/manifest.json declares, which Thunderbird's own
     shortcut manager shows and lets you rebind, force a check and open
     that window
  9. close Thunderbird to read the report

END
fi

# MOZ_NO_REMOTE is required: --new-instance is not enough to detach from an
# already running Thunderbird, startup then hangs without a window.
export MOZ_NO_REMOTE=1
cmd=(thunderbird --profile "$profile")
if [ -n "$headless" ]; then
    cmd=(timeout "$observation" "${cmd[@]}" --headless)
fi

set +e
"${cmd[@]}" >"$log" 2>&1
status=$?
set -e
echo "Thunderbird exited with code $status."

echo "=== extension report ==="
grep -a "\[OLC" "$log" || echo "(no line: the extension did not load)"
echo "=== log errors ==="
grep -a -i -E "error|exception|warning" "$log" | grep -av "\[OLC" | head -20 || true
echo "full log: $log"

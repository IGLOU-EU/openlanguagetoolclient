#!/usr/bin/env bash
# Builds the extension package, the one file Thunderbird installs and ATN
# publishes. The only place in the project where the package is described:
# lancer.sh installs what it produces, and the pipeline publishes it, so the
# version under test and the version released are built the same way.
#
#   ./package.sh /tmp/openlanguagetoolclient.xpi
#
# All of src/ goes into the package: the file list is written nowhere, it is
# the folder's.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$root/src"

destination="${1:-}"
if [ -z "$destination" ]; then
    echo "usage: ${BASH_SOURCE[0]} <destination.xpi>" >&2
    exit 2
fi

# zip writes relative to where it runs, and it runs inside src/ so that the
# archive holds manifest.json at its root and not a src/ folder.
case "$destination" in
    /*) ;;
    *) destination="$PWD/$destination" ;;
esac

# An existing archive would be added to rather than replaced, leaving a file
# that was deleted from src/ inside the package for good.
rm -f "$destination"

# -X drops the uid and the extended attributes of the machine that built it,
# which nothing in the package needs and which would make two builds of the
# same commit differ.
( cd "$src" && zip -qrX "$destination" . )

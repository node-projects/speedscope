#!/bin/sh
set -eu
# Build this checkout instead of downloading the upstream unscoped npm package.
exec npm run prepack

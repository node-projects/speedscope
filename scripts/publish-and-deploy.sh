#!/bin/sh
set -eu
echo 'Publishing is release-driven. Create a GitHub release in node-projects/speedscope.'
echo 'After manually publishing 2.0.0, configure OIDC and use a new release tag such as v2.0.1.'
echo 'See docs/RELEASING.md for one-time npm authorization and retry instructions.'
exit 1

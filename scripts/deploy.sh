#!/bin/sh
set -eu
# Compatibility wrapper; deployments now use the fork's Pages workflow.
exec gh workflow run pages.yml --repo node-projects/speedscope --ref main

#!/bin/sh
set -eu

if ! temporal operator namespace describe --namespace default --command-timeout 15s >/dev/null; then
  temporal operator namespace create --namespace default --retention 24h --command-timeout 15s
fi
temporal operator namespace describe --namespace default --command-timeout 15s >/dev/null

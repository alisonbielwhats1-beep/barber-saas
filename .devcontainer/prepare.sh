#!/usr/bin/env bash
set -euo pipefail
umask 077
mkdir -p .demo
chmod 700 .demo
if [ ! -s .demo/postgres-password ]; then openssl rand -hex 32 > .demo/postgres-password; fi
if [ ! -s .demo/redis-token ]; then openssl rand -hex 32 > .demo/redis-token; fi
printf '{"%s":{"srh_id":"everflair-demo","connection_string":"redis://redis:6379","max_connections":3}}' "$(cat .demo/redis-token)" > .demo/redis-config.json

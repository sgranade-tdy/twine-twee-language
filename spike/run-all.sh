#!/bin/sh
# One child process per (format, file, level). Output: results.jsonl
: > results.jsonl
for fmt in sugarcube chapbook; do
  for f in story.js chapbook-story.js jquery.js jquery.min.js lodash.js lodash.min.js three.module.js three.core.js broken-midedit.js broken-truncated.js broken-string.js; do
    timeout 300 node --expose-gc --stack-size=4000 --import=tsx run-one.ts $fmt inputs/$f >> results.jsonl 2>>errors.log || echo "{\"format\":\"$fmt\",\"file\":\"$f\",\"crashed\":$?}" >> results.jsonl
  done
done
for f in chapbook-story.js jquery.js three.core.js broken-midedit.js; do
  timeout 300 node --expose-gc --import=tsx run-one.ts chapbook inputs/$f names >> results.jsonl 2>>errors.log
done

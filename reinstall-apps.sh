#!/bin/bash

for d in mtpx*/; do [ -d "$d" ] || continue; echo "cd $d"; (cd "$d" && rm -rf node_modules bun.lock && bun install); done

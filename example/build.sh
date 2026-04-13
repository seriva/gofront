#!/bin/sh
# Build the GoFront todo example.
# Run from the repo root:  sh example/build.sh

set -e
node src/index.js example/src -o example/app.js
echo "Built → example/app.js"
echo "Open  → example/index.html"

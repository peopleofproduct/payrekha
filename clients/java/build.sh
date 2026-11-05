#!/usr/bin/env sh
# Compile and run the round-trip test. JDK 17+, no build tool needed.
set -eu
cd "$(dirname "$0")"
rm -rf build && mkdir -p build
javac --release 17 -d build $(find src -name '*.java')
java -cp build city.theproduct.payrekha.IntentSignerTest ../vectors/intent-v1.json

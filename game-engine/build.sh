#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Building game-engine for wasm32-unknown-unknown..."
cargo build --target wasm32-unknown-unknown --release

echo "Running wasm-bindgen..."
mkdir -p ../client/public/wasm
wasm-bindgen --out-dir ../client/public/wasm --target web \
  ../target/wasm32-unknown-unknown/release/stem_game_engine.wasm

echo "Done. WASM output in client/public/wasm/"

#!/usr/bin/env bash
# Builds vendor/espeak-ng-ne/: espeak-ng compiled to WebAssembly with only the
# Nepali voice and the phoneme tables, used by the Nepali (Piper) voices.
#
# The espeak-ng commit is the one piper1-gpl pins, so phonemes match what the
# voices were trained on. The output is committed; rerun this script only to
# change the espeak-ng version, and review the phoneme test in
# tests/unit/nepali.test.ts afterwards.
#
# Needs git, cmake, ninja, a C compiler and an activated emsdk (emcc on PATH).
#   source /path/to/emsdk/emsdk_env.sh && scripts/espeak/build.sh
set -euo pipefail

COMMIT=724808c5a83f9ef95fdd0db886ba7ba537ff224a
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/vendor/espeak-ng-ne"
# espeak-ng truncates data paths at 160 characters, so build under a short path.
WORK="${WORK:-/tmp/kr-espeak}"
FLAGS=(-DCMAKE_BUILD_TYPE=Release -DUSE_ASYNC=OFF -DUSE_MBROLA=OFF -DUSE_LIBSONIC=OFF -DUSE_LIBPCAUDIO=OFF
  -DUSE_KLATT=OFF -DUSE_SPEECHPLAYER=OFF -DBUILD_SHARED_LIBS=OFF -DENABLE_TESTS=OFF)

mkdir -p "$WORK"
if [ ! -d "$WORK/espeak-ng/.git" ]; then git clone https://github.com/espeak-ng/espeak-ng.git "$WORK/espeak-ng"; fi
git -C "$WORK/espeak-ng" checkout -q "$COMMIT"

# 1. Native build: compiles the phoneme tables and dictionaries (espeak-ng-data).
cmake -S "$WORK/espeak-ng" -B "$WORK/native" -G Ninja "${FLAGS[@]}"
cmake --build "$WORK/native"

# 2. Only what Nepali needs: phoneme tables, intonation, the ne dictionary and
#    voice, plus English, which espeak-ng switches to for English words
#    inside Nepali text (as it did for the voices' training data).
DATA="$WORK/data/espeak-ng-data"
rm -rf "$WORK/data" && mkdir -p "$DATA/lang/inc" "$DATA/lang/gmw"
for file in phondata phonindex phontab intonations ne_dict en_dict; do cp "$WORK/native/espeak-ng-data/$file" "$DATA/"; done
cp "$WORK/native/espeak-ng-data/lang/inc/ne" "$DATA/lang/inc/ne"
cp "$WORK/native/espeak-ng-data/lang/gmw/en" "$DATA/lang/gmw/en"

# 3. WebAssembly build of the library, linked with the glue.
# Emscripten's <wchar.h> declares iswalnum() and friends, which espeak-ng's
# compat <wctype.h> renames to ucd_* macros. Including the real <wchar.h>
# first declares them before the macros exist.
SYSROOT_WCHAR="$(dirname "$(command -v emcc)")/cache/sysroot/include/wchar.h"
emcmake cmake -S "$WORK/espeak-ng" -B "$WORK/wasm" -G Ninja "${FLAGS[@]}" -DCOMPILE_INTONATIONS=OFF \
  "-DCMAKE_C_FLAGS=-include $SYSROOT_WCHAR"
cmake --build "$WORK/wasm" --target espeak-ng ucd
mkdir -p "$OUT"
emcc -O3 "$ROOT/scripts/espeak/glue.c" \
  -I "$WORK/espeak-ng/src/include" \
  "$WORK/wasm/src/libespeak-ng/libespeak-ng.a" "$WORK/wasm/src/ucd-tools/libucd.a" \
  --embed-file "$WORK/data@/data" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createEspeak -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sFILESYSTEM=1 -sINCOMING_MODULE_JS_API=locateFile \
  -sEXPORTED_FUNCTIONS=_kr_init,_kr_phonemize,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=ccall \
  -o "$OUT/espeak-ng-ne.mjs"

git -C "$WORK/espeak-ng" log -1 --format='espeak-ng %H (%cd)' > "$OUT/VERSION"
emcc --version | head -1 >> "$OUT/VERSION"
ls -la "$OUT"

#!/bin/sh
# Build audiolab-recorder for the current platform into ../bin/<platform>-<arch>/.
# Requires only a C compiler: cc/gcc/clang on Linux and macOS.
set -e
cd "$(dirname "$0")"

case "$(uname -s)" in
  Linux)  PLATFORM=linux ;;
  Darwin) PLATFORM=darwin ;;
  *) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64)        ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

OUT="../bin/${PLATFORM}-${ARCH}"
mkdir -p "$OUT"

if [ "$PLATFORM" = "darwin" ]; then
  cc -O2 -s -o "$OUT/audiolab-recorder" recorder.c \
    -framework CoreAudio -framework AudioUnit -framework AudioToolbox \
    -framework CoreFoundation -lpthread -lm
else
  cc -O2 -s -o "$OUT/audiolab-recorder" recorder.c -lpthread -lm -ldl
fi

echo "built $OUT/audiolab-recorder"

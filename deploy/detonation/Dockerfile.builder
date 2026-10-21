# detonation-ocean/builder: builds the harmless test binaries of docs/SPEC.md 11 and 12 (AT-19 to AT-24) from samples/src.
# Two targets, both built from stdin (no build context) by tools/build-test-binaries.sh and run there with --network none:
#   compile    mingw-w64 (C compiler) and upx-ucl (packer)
#   installer  the Inno Setup 6 compiler (Windows-only), run under Wine 8.0
# Why two bases: Debian 12 (bookworm) has no upx-ucl package, so the compile target uses Debian 13 (trixie); the installer target stays on
# bookworm so that it carries the same Wine 8.0 as the detonate image will. Bases are pinned by digest (resolved 2026-10-08).
# These tools only build files; no target ever runs a built sample.

FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f AS compile
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc-mingw-w64-x86-64 gcc-mingw-w64-i686 upx-ucl \
 && rm -rf /var/lib/apt/lists/*

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587 AS installer

# 6.3.3 is the newest Inno Setup that the innoextract shipped in the detonate image can read (6.3.3 and older).
ARG INNO_VERSION=6.3.3
ARG INNO_TAG=is-6_3_3
# Published asset digest of the immutable GitHub release is-6_3_3 (https://github.com/jrsoftware/issrc/releases/tag/is-6_3_3).
ARG INNO_SHA256=0bcb2a409dea17e305a27a6b09555cabe600e984f88570ab72575cd7e93c95e6

ENV DEBIAN_FRONTEND=noninteractive WINEPREFIX=/opt/wineprefix WINEARCH=win32 WINEDEBUG=-all DISPLAY=:99

RUN dpkg --add-architecture i386 \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl wine wine64 wine32:i386 libwine libwine:i386 xvfb xauth \
 && rm -rf /var/lib/apt/lists/*

# Official Inno Setup installer from its GitHub release, checked against the published SHA-256, installed silently into a 32-bit prefix.
RUN curl --fail --silent --show-error --location --output /tmp/innosetup.exe \
      "https://github.com/jrsoftware/issrc/releases/download/${INNO_TAG}/innosetup-${INNO_VERSION}.exe" \
 && echo "${INNO_SHA256}  /tmp/innosetup.exe" | sha256sum --check - \
 && (Xvfb :99 -screen 0 1024x768x16 & xvfb=$! ; sleep 3 \
     && wine /tmp/innosetup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- '/DIR=C:\InnoSetup' \
     && wineserver --wait ; kill $xvfb) \
 && rm /tmp/innosetup.exe \
 && test -f "$WINEPREFIX/drive_c/InnoSetup/ISCC.exe"

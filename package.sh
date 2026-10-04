#!/usr/bin/env sh
# Gera dist/miccam-guard-<versão>.zip para a Chrome Web Store e GitHub Releases.
set -e
v=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' manifest.json | head -1)
mkdir -p dist
rm -f "dist/miccam-guard-$v.zip"
zip -r "dist/miccam-guard-$v.zip" manifest.json src _locales
echo "dist/miccam-guard-$v.zip"

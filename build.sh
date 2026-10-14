#!/usr/bin/env bash
set -e
echo "Installing dependencies..."
npm install
echo "Building production bundle..."
npm run build
echo "Build finished at ./build"

#!/usr/bin/env bash
set -e
echo "Installing dependencies..."
npm install
echo "Building production bundle..."
npm run build
echo "Build finished at ./build"

mkdir templates

cp ./build/index.html templates/
sed -i 's|\./static|/static|g' templates/index.html

cp -r ./build/static .


#!/usr/bin/env bash
pip install flask
pip install flask-cor
pip install gunicorn
set -e
echo "Installing dependencies..."
npm install
echo "Building production bundle..."
npm run build
echo "Build finished at ./build"

mkdir template

cp ./build/index.html template/
sed -i 's|\./static|/static|g' template/index.html

cp -r ./build/static .


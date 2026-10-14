import React from "react";
import { createRoot } from "react-dom/client";#!/usr/bin/env bash
set -e
echo "Installing dependencies..."
npm ci
echo "Building production bundle..."
npm run build
echo "Build finished at ./build"
import "bootstrap/dist/css/bootstrap.min.css";
import App from "./App";

const container = document.getElementById("root");
const root = createRoot(container);
root.render(<App />);

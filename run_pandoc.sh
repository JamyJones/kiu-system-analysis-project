#!/bin/bash

echo "$1" | pandoc -f markdown --pdf-engine=xelatex -t html


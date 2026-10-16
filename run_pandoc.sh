#!/bin/bash

echo "$1" | pandoc -f markdown --mathml -t html5


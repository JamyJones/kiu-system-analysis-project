#!/bin/bash
# run_pandoc.sh
# Read markdown from stdin and convert using pandoc.
# Usage:
#   ./run_pandoc.sh                 -> converts stdin markdown to HTML (html5) and writes to stdout
#   ./run_pandoc.sh html            -> same as above
#   ./run_pandoc.sh docx /tmp/out.docx
#   ./run_pandoc.sh pdf  /tmp/out.pdf
# Note: pandoc must be installed and available on PATH. PDF output requires a working LaTeX toolchain.
pip install pandoc
FORMAT="$1"
OUTFILE="$2"

if [ -z "$FORMAT" ] || [ "$FORMAT" = "html" ]; then
  # Convert to HTML5 and write to stdout
  pandoc -f markdown --mathml -t html5
  exit $?
fi

if [ -z "$OUTFILE" ]; then
  echo "Error: output file path required for format $FORMAT" >&2
  exit 2
fi

# For docx/pdf we can let pandoc write to the given outfile
case "$FORMAT" in
  docx)
    pandoc -f markdown -t docx -o "$OUTFILE"
    ;;
  pdf)
    pandoc -f markdown -t pdf -o "$OUTFILE"
    ;;
  *)
    echo "Unsupported format: $FORMAT" >&2
    exit 3
    ;;
esac

exit $?

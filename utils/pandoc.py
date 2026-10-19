import subprocess
import tempfile
import os
import io
import traceback
from flask import jsonify, make_response

# optional dependency for xlsx conversion
try:
    import pandas as pd
except Exception:
    pd = None


def render_to_html(req_or_md):
    """
    If given a Flask request, read JSON { mdText }.
    If given a string, treat that as markdown text.
    Returns HTML string.
    """
    if hasattr(req_or_md, "get_json"):
        data = req_or_md.get_json() or {}
        md = data.get("mdText", "")
    else:
        md = req_or_md or ""

    # run run_pandoc.sh html and feed md via stdin
    res = subprocess.run(
        ["./run_pandoc.sh", "html"],
        input=md,
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f"Pandoc failed: {res.returncode} {res.stderr}")
    return res.stdout


def convert_md(req):
    """
    Expects JSON: { mdText: string, format: 'docx'|'pdf'|'xlsx'|'html' }
    Returns:
      - JSON {"html": "..."} for html
      - Flask response with file bytes for docx/pdf/xlsx
    """
    try:
        data = req.get_json() or {}
        md = data.get("mdText", "")['text']
        fmt = (data.get("format") or "html").lower().strip()

        if fmt == "html":
            html = render_to_html(md)
            return jsonify({"html": html})

        if fmt in ("docx", "pdf"):
            suffix = f".{fmt}"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmpf:
                tmp_path = tmpf.name

            try:
                # run run_pandoc.sh FORMAT OUTFILE, reading md on stdin
                res = subprocess.run(
                    ["./run_pandoc.sh", fmt, tmp_path],
                    input=md,
                    capture_output=True,
                    text=True,
                )
                if res.returncode != 0:
                    raise RuntimeError(f"Pandoc failed: {res.returncode} {res.stderr}")

                with open(tmp_path, "rb") as fh:
                    data_bytes = fh.read()

                resp = make_response(data_bytes)
                if fmt == "docx":
                    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    filename = "document.docx"
                else:
                    mime = "application/pdf"
                    filename = "document.pdf"

                resp.headers.set("Content-Type", mime)
                resp.headers.set("Content-Disposition", f'attachment; filename="{filename}"')
                return resp
            finally:
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass

        if fmt == "xlsx":
            if pd is None:
                return make_response("Server missing pandas dependency required for xlsx conversion", 500)

            # Render HTML first
            html = render_to_html(md)

            # parse tables using pandas.read_html (requires lxml or html5lib)
            try:
                tables = pd.read_html(html)
            except Exception as e:
                return make_response(f"Failed to parse tables from HTML for xlsx conversion: {str(e)}", 400)

            if not tables:
                return make_response("No table found in HTML; cannot generate Excel.", 400)

            output = io.BytesIO()
            with pd.ExcelWriter(output, engine="openpyxl") as writer:
                for i, df in enumerate(tables):
                    sheet_name = f"Sheet{i+1}"
                    df.to_excel(writer, sheet_name=sheet_name, index=False)
                writer.save()

            output.seek(0)
            resp = make_response(output.read())
            resp.headers.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            resp.headers.set("Content-Disposition", 'attachment; filename="table.xlsx"')
            return resp

        return make_response(f"Unsupported conversion format: {fmt}", 400)
    except Exception as e:
        tb = traceback.format_exc()
        return make_response(f"Conversion error: {str(e)}\n\n{tb}", 500)

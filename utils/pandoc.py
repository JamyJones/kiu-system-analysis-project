import subprocess

def render_to_html(req):
    data = req.get_json() or {}
    md = data.get("mdText", "")
    # Call pandoc directly and pass markdown via stdin to avoid shell-escaping limits
    res = subprocess.run(
        ["pandoc", "-f", "markdown", "-t", "html"],
        input=md,
        capture_output=True,
        text=True,
        check=True,
    )
    return res.stdout

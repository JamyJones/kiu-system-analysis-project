import subprocess
def render_to_html(req):
    data=req.get_json()
    md=data["mdText"]
    res = subprocess.run(
        ["./run_pandoc.sh", md],
        capture_output=True,
        text=True,
        check=True,
    )
     return res.stdout



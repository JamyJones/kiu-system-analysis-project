from flask import (
    Flask,
    Response,
    request,
    jsonify,
    render_template,
    make_response
)
from flask_cors import CORS
from utils.ocr import submit_job, job_status, fetch_url

# updated pandoc utilities
from utils.pandoc import render_to_html, convert_md

app = Flask(__name__)
CORS(app)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/ocr/jobs", methods=["POST", "OPTIONS"])
def submit_job_route():
    return submit_job(request)

@app.route("/ocr/jobs/<job_id>", methods=["GET"])
def job_status_route(job_id):
    return job_status(job_id, request)

@app.route("/ocr/fetch", methods=["GET"])
def fetch_url_route():
    return fetch_url(request)

# backward-compatible pandoc -> HTML endpoint
@app.route("/ocr/pandoc", methods=["POST"])
def md_to_html():
    html = render_to_html(request)
    return jsonify({"html":html})

# new convert endpoint used by frontend: accepts { mdText, format }
@app.route("/ocr/convert", methods=["POST"])
def md_convert_route():
    return convert_md(request)


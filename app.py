from flask import (
    Flask,
    Response,
    request,
    jsonify,
    render_template
)
from flask_cors import CORS
from utils.ocr import submit_job, job_status, fetch_url

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


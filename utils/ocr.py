# utils.py
import os
import requests
from flask import Response, jsonify, stream_with_context, request
from requests.exceptions import RequestException
from urllib.parse import urlparse

PADDLE_JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
PADDLE_TOKEN = "6b505de3aac2c92a72bb58ce95fdff1d048aa918"

def _auth_headers(client_auth_header=None):
    """
    Prefer server-side token. If not set and client provided Authorization, use that.
    Returns headers dict for requests library (only Authorization included).
    """
    if PADDLE_TOKEN:
        return {"Authorization": f"bearer {PADDLE_TOKEN}"}
    if client_auth_header:
        return {"Authorization": client_auth_header}
    return {}

def _create_response_from_requests(resp, stream=False):
    try:
        status = resp.status_code
        content_type = resp.headers.get("Content-Type", "application/octet-stream")
        # copy a few safe headers back to client
        headers_to_copy = {}
        if "Content-Disposition" in resp.headers:
            headers_to_copy["Content-Disposition"] = resp.headers["Content-Disposition"]
        if stream:
            return Response(
                stream_with_context(resp.iter_content(chunk_size=8192)),
                status=status,
                content_type=content_type,
                headers=headers_to_copy
            )
        else:
            return Response(resp.content, status=status, content_type=content_type, headers=headers_to_copy)
    except Exception as e:
        return jsonify({"error": "Failed to build response", "detail": str(e)}), 500

def submit_job(flask_request):
    """
    Handles both JSON (fileUrl) and multipart form uploads.
    Expects flask_request (the incoming Flask request object).
    Returns a Flask Response (usually JSON forwarded from PaddleOCR).
    """
    try:
        auth = _auth_headers(flask_request.headers.get("Authorization"))
        # JSON mode (fileUrl)
        if flask_request.is_json:
            body = flask_request.get_json(silent=True) or {}
            resp = requests.post(PADDLE_JOB_URL, json=body, headers={**auth, "Content-Type": "application/json"})
            return _create_response_from_requests(resp, stream=False)

        # Form-data (file upload)
        if "file" in flask_request.files:
            fileobj = flask_request.files["file"]
            data = {}
            if "model" in flask_request.form:
                data["model"] = flask_request.form.get("model")
            if "optionalPayload" in flask_request.form:
                data["optionalPayload"] = flask_request.form.get("optionalPayload")

            # requests accepts file tuple: (filename, fileobj.stream, content_type)
            files = {"file": (fileobj.filename, fileobj.stream, fileobj.mimetype)}
            resp = requests.post(PADDLE_JOB_URL, data=data, files=files, headers=auth)
            return _create_response_from_requests(resp, stream=False)

        # Unsupported
        return jsonify({"error": "Unsupported request. Send JSON with fileUrl or multipart/form-data with 'file' field."}), 400

    except RequestException as e:
        # Upstream network error
        return jsonify({"error": "Upstream request failed", "detail": str(e)}), 502
    except Exception as e:
        return jsonify({"error": "Server error", "detail": str(e)}), 500

def job_status(job_id, flask_request):
    """
    Proxy GET status for a job id.
    """
    try:
        auth = _auth_headers(flask_request.headers.get("Authorization"))
        resp = requests.get(f"{PADDLE_JOB_URL}/{job_id}", headers=auth)
        return _create_response_from_requests(resp, stream=False)
    except RequestException as e:
        return jsonify({"error": "Upstream request failed", "detail": str(e)}), 502
    except Exception as e:
        return jsonify({"error": "Server error", "detail": str(e)}), 500

def fetch_url(flask_request):
    """
    Fetch arbitrary URL
    """
    try:
        target = flask_request.args.get("url")
        if not target:
            return jsonify({"error": "Missing 'url' query parameter"}), 400


        upstream = requests.get(target, stream=True)
        return _create_response_from_requests(upstream, stream=True)
    except RequestException as e:
        return jsonify({"error": "Fetch failed", "detail": str(e)}), 502
    except Exception as e:
        return jsonify({"error": "Server error", "detail": str(e)}), 500


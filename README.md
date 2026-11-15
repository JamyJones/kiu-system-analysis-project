# Handwriting Digitiser

A full-stack OCR and document conversion application that lets users upload a document or image, send it to PaddleOCR through a Flask API, poll for processing results, preview extracted markdown, and export the result as HTML, DOCX, PDF, or Excel.

This project combines:
- a React frontend for file upload, job tracking, and download actions
- a Flask backend as a proxy and conversion service
- PaddleOCR as the external recognition engine
- Pandoc-based conversion for document export

## System overview

The application flow is:
1. User uploads a file from the React UI.
2. The frontend sends the file to the backend endpoint `/ocr/jobs`.
3. The Flask service forwards the upload to the PaddleOCR API.
4. The UI polls `/ocr/jobs/<job_id>` until the processing status is complete.
5. The backend fetches the result URL and the frontend downloads the extracted JSONL data.
6. The result is parsed into markdown fragments and rendered in the browser.
7. Users can export the markdown as HTML, DOCX, PDF, or Excel.

## Architecture

### Frontend
Located in `src/`.

- `src/App.js` bootstraps the app.
- `src/AppLogic.js` contains the application logic, state, polling, file handling, and export actions.
- `src/AppUI.js` renders the UI, tabs, model controls, upload area, and result/download panels.
- `src/index.js` mounts the React app into the browser.

Key frontend responsibilities:
- select or capture a file
- choose OCR model and optional recognition flags
- submit OCR job
- poll OCR status
- download processed JSON results
- render markdown preview
- convert markdown to various output formats

### Backend
Located in `app.py` and `utils/`.

- `app.py` exposes the API endpoints and routes.
- `utils/ocr.py` forwards OCR jobs to PaddleOCR and proxies status/fetch requests.
- `utils/pandoc.py` converts Markdown into HTML/DOCX/PDF/XLSX using Pandoc and pandas.
- `run_pandoc.sh` is a shell wrapper used to invoke Pandoc from Python.

## Repository structure

```text
.
├── app.py
├── build.sh
├── package.json
├── run_pandoc.sh
├── README.md
├── public/
├── src/
│   ├── App.js
│   ├── AppLogic.js
│   ├── AppUI.js
│   └── index.js
├── templates/
│   └── index.html
├── static/
├── utils/
│   ├── ocr.py
│   └── pandoc.py
└── .github/
```

## Core components

### 1. Frontend logic (`src/AppLogic.js`)

This hook manages the application state:
- `file` and `previewUrl`
- selected OCR `model`
- optional processing flags:
  - `useDocOrientationClassify`
  - `useDocUnwarping`
  - `useChartRecognition`
- `status`, `jobId`, `results`, and UI tabs
- polling callbacks and timeout management

Functions exposed by the hook include:
- `submitJob()`
- `pollJob(jid)`
- `fetchJsonlAndProcess(jsonlUrl)`
- `handleDownloadMarkdown(item)`
- `handleConvert(item, format, e)`
- `isTopLevelTable(html)`

### 2. Backend OCR proxy (`utils/ocr.py`)

This module acts as a server-side proxy to PaddleOCR.

Endpoints it supports:
- `submit_job(flask_request)`
- `job_status(job_id, flask_request)`
- `fetch_url(flask_request)`

Important behavior:
- reads the PaddleOCR API token from the server-side constant `PADDLE_TOKEN`
- accepts either JSON upload or multipart form upload
- forwards `Authorization` headers when present
- returns proxied HTTP responses from the upstream OCR API

### 3. Markdown conversion (`utils/pandoc.py`)

This service converts Markdown into export formats.

Supported conversions:
- HTML
- DOCX
- PDF
- XLSX

The module executes Pandoc through `run_pandoc.sh` and optionally uses pandas to convert tables into Excel workbooks.

### 4. API layer (`app.py`)

The Flask app defines routes for the frontend:

| Route | Method | Description |
| --- | --- | --- |
| `/` | GET | Serves the React app shell |
| `/ocr/jobs` | POST | Submits an OCR job |
| `/ocr/jobs/<job_id>` | GET | Polls OCR job status |
| `/ocr/fetch` | GET | Fetches a result payload URL |
| `/ocr/pandoc` | POST | Converts markdown to HTML |
| `/ocr/convert` | POST | Converts markdown to HTML/DOCX/PDF/XLSX |
| `/ocr/about` | GET | Returns project information |

## API contracts

### OCR job submission

Request format:
- multipart form-data with `file`, `model`, and `optionalPayload`

Example:

```bash
curl -X POST http://localhost:5000/ocr/jobs \
  -F "file=@sample.png" \
  -F "model=PaddleOCR-VL-1.6" \
  -F 'optionalPayload={"useDocOrientationClassify":false,"useDocUnwarping":false,"useChartRecognition":false}'
```

Expected upstream response:

```json
{
  "code": 0,
  "data": {
    "jobId": "abc123"
  }
}
```

### Polling job status

```bash
curl http://localhost:5000/ocr/jobs/abc123
```

Response contains state such as:
- `pending`
- `running`
- `done`
- `failed`

### Fetch result JSONL

```bash
curl "http://localhost:5000/ocr/fetch?url=https://example.com/result.jsonl"
```

This streams the fetched file so the frontend can read extracted OCR results.

### Markdown conversion

Request body:

```json
{
  "mdText": "# Title\n\nHello world",
  "format": "pdf"
}
```

Endpoint:

```bash
POST /ocr/convert
```

Supported formats:
- `html`
- `docx`
- `pdf`
- `xlsx`

## Data flow

```text
User upload
   ↓
React UI (src/AppUI.js)
   ↓
useAppLogic submitJob()
   ↓
Flask /ocr/jobs
   ↓
PaddleOCR API
   ↓
Polling /ocr/jobs/<job_id>
   ↓
Fetch result JSONL
   ↓
Markdown extraction and preview
   ↓
Pandoc conversion / PDF / DOCX / XLSX export
```

## Dependencies

### Node.js frontend
The frontend dependency set is defined in `package.json` and includes:
- `react`
- `react-dom`
- `react-scripts`
- `bootstrap`
- `@fortawesome/react-fontawesome`
- `@lottiefiles/dotlottie-react`

### Python backend
The Python backend relies on:
- Flask
- flask-cors
- requests
- pandas
- openpyxl
- Pandoc CLI

## Setup and run

### Prerequisites
- Node.js 18+
- Python 3.10+
- Pandoc installed and available on `PATH`
- optionally, a working LaTeX toolchain for PDF export

### Install frontend dependencies

```bash
npm install
```

### Install Python dependencies

```bash
pip install flask flask-cors requests pandas openpyxl
```

### Set executable permissions for Pandoc wrapper

```bash
chmod +x run_pandoc.sh
```

### Run the app in development mode

Start the Flask backend:

```bash
python app.py
```

Or with Flask CLI:

```bash
flask run
```

Start the React frontend:

```bash
npm start
```

### Production build

```bash
bash build.sh
```

This script runs the production React build and copies the result into the Flask app template/static directories.

## Configuration

Important configuration values are in the code:

- `ROUTE_BASE` in `src/AppLogic.js` is set to `/ocr`
- `PADDLE_JOB_URL` in `utils/ocr.py` points to the PaddleOCR service endpoint
- `PADDLE_TOKEN` stores the backend token used for upstream requests

If deployment is moved to a different host or authentication model, the relevant values should be updated in these locations.

## Security and deployment notes

- The server acts as a proxy to an external OCR API and should be protected behind authentication if exposed publicly.
- The project currently keeps the PaddleOCR token in source code, which is acceptable for a demo but not recommended for production deployments.
- User-uploaded files should be validated and cleaned up in production environments.
- The `/ocr/fetch` endpoint can retrieve arbitrary external URLs; this should be restricted or validated in production to avoid SSRF-like risks.

## Known implementation notes

The code is a prototype/demo application and has a few implementation caveats:

- The frontend uses `localStorage` for theme persistence.
- The About screen pulls README content from the GitHub raw URL.
- The conversion functions assume a valid Markdown payload and may fail on malformed content.
- Some conversion logic depends on Pandoc, LaTeX, and pandas being installed and working in the runtime environment.

## Troubleshooting

### Pandoc conversion errors

Symptoms:
- `/ocr/convert` fails
- output says Pandoc failed

Checks:
- confirm `pandoc` is installed: `pandoc --version`
- ensure `run_pandoc.sh` is executable
- verify the script has the required permissions and is located in the app root

### OCR job never completes

Checks:
- verify the upstream PaddleOCR service is reachable
- confirm the API token is valid
- inspect the backend logs for request/response errors
- confirm the uploaded file type is allowed by the OCR service

### Frontend shows no results

Checks:
- ensure the backend is running
- ensure the frontend is calling the correct base URL (`/ocr`)
- inspect the browser console for fetch and parsing errors

## Future improvements

Potential enhancements for the system include:
- environment-based configuration using `.env` files
- encrypted or externalized API credentials
- better validation for upload types and file sizes
- job persistence in a database
- stronger security controls on the fetch proxy
- CI/CD validation and automated tests
- clearer user-facing error handling and retry logic

## Summary

This project is a document digitisation and OCR conversion system that bridges a modern React interface with a Flask API and external OCR capabilities. It is designed for end-to-end processing from file upload to result extraction and export, making it suitable for tasks like scanned document recognition, markdown generation, and document conversion.

This README should be treated as the project’s primary developer and operator documentation.

# Technical Design Document

## 1. Purpose

This system is a browser-based OCR and document conversion platform that allows users to upload an image or document, submit it to PaddleOCR for extraction, monitor processing status, preview the result as markdown, and export the processed content to common document formats.

The application is structured as a React frontend connected to a Flask API layer that proxies OCR requests to PaddleOCR and performs local conversion tasks using Pandoc and related utilities.

## 2. Goals and non-goals

### Goals
- Provide a simple file upload experience for OCR workflows.
- Support asynchronous OCR processing via job polling.
- Render OCR results as markdown and preview them in the browser.
- Enable conversion of results to HTML, DOCX, PDF, and Excel.
- Keep the system deployable as a single application with a frontend and backend runtime.

### Non-goals
- Full user authentication and authorization.
- Long-term job persistence in a database.
- Complex document storage or multi-tenant architecture.
- Enterprise-grade security hardening for external URL fetching.

## 3. High-level architecture

The system is composed of three major layers:

1. Client layer: React application running in the browser.
2. Application layer: Flask server exposing REST endpoints.
3. External service layer: PaddleOCR API and Pandoc CLI-based conversion tools.

```text
Browser (React)
  │
  ├─ Upload file / show preview
  ├─ Submit OCR job
  ├─ Poll job status
  ├─ Fetch result JSONL
  └─ Convert markdown to DOCX/PDF/HTML/XLSX
  │
  ▼
Flask API (app.py + utils)
  │
  ├─ /ocr/jobs -> proxy OCR submission to PaddleOCR
  ├─ /ocr/jobs/<id> -> query job status
  ├─ /ocr/fetch -> fetch arbitrary result URL
  ├─ /ocr/pandoc -> markdown to HTML
  ├─ /ocr/convert -> markdown to document formats
  └─ /ocr/about -> project metadata
  │
  ▼
External services
  ├─ PaddleOCR job API
  ├─ Result URLs (JSONL files)
  └─ Pandoc CLI + pandas/openpyxl
```

## 4. Components

### 4.1 Frontend

Location: `src/`

#### `src/App.js`
- Root component that initializes the app.
- Instantiates the custom hook `useAppLogic()` and passes the returned logic object to `AppUI`.

#### `src/AppLogic.js`
This is the central state and behavior module for the UI.

Responsibilities:
- file selection and preview generation
- model selection and optional OCR flags
- job submission and polling logic
- result fetching and parsing
- markdown rendering and conversion handling
- dark theme and modal state

Notable state values:
- `file`
- `previewUrl`
- `model`
- `status`
- `jobId`
- `results`
- `activeTab`
- `dark`
- `showAbout`

Key actions:
- `submitJob()`
- `pollJob(jobId)`
- `fetchJsonlAndProcess(jsonlUrl)`
- `handleConvert(item, format, e)`
- `handleDownloadMarkdown(item)`
- `isTopLevelTable(html)`

#### `src/AppUI.js`
Responsible for all rendering and UI interactions.

Features include:
- top bar with theme toggle and About panel
- upload and camera capture controls
- model settings off-canvas
- tabs for Input, Results, and Downloads
- status banner with animated state indicator
- fireworks completion animation
- markdown preview and export buttons

### 4.2 Backend

Location: `app.py`, `utils/ocr.py`, `utils/pandoc.py`

#### `app.py`
Defines the Flask app and exposes routes for the frontend.

Routes:
- `/` serves the application shell.
- `/ocr/jobs` accepts OCR submissions.
- `/ocr/jobs/<job_id>` polls the job state.
- `/ocr/fetch` fetches a remote result stream.
- `/ocr/pandoc` renders markdown to HTML.
- `/ocr/convert` converts markdown to DOCX/PDF/HTML/XLSX.
- `/ocr/about` returns project metadata.

#### `utils/ocr.py`
This module acts as the upstream gateway to PaddleOCR.

Behavior:
- receives uploaded files or JSON requests
- constructs a request for the PaddleOCR API
- returns the upstream response to the frontend
- exposes helper functions for job status and result fetching

Key constants:
- `PADDLE_JOB_URL`
- `PADDLE_TOKEN`

This module also supports generic URL fetching via `fetch_url()`, which is used to retrieve the output result files referenced by the OCR job.

#### `utils/pandoc.py`
Handles Markdown conversion to export formats.

Supported conversions:
- HTML
- DOCX
- PDF
- XLSX

Implementation behavior:
- calls `./run_pandoc.sh` for HTML and document conversion
- uses pandas and openpyxl for Excel export when tables are present
- returns either JSON or binary file responses depending on format

#### `run_pandoc.sh`
Shell wrapper around the Pandoc CLI.

Used to:
- convert markdown to HTML on stdout
- generate DOCX or PDF output files from markdown input

## 5. Process flows

### 5.1 OCR submission flow

1. User selects a file in the React UI.
2. Frontend validates the file and stores preview data if image-based.
3. `submitJob()` POSTs a multipart form to `/ocr/jobs`.
4. Flask route forwards the request to PaddleOCR.
5. PaddleOCR returns a `jobId` in the response.
6. Frontend stores the job ID and sets the active tab to Results.
7. UI starts polling the job.

### 5.2 Job polling and result retrieval flow

1. `pollJob(jobId)` requests `/ocr/jobs/<job_id>`.
2. Backend forwards GET request to PaddleOCR.
3. Response state is evaluated.
4. The frontend updates status text based on one of:
   - `pending`
   - `running`
   - `done`
   - `failed`
5. When job is complete, the frontend extracts `resultUrl.jsonUrl` from the job payload.
6. It calls `/ocr/fetch?url=<signed_result_url>`.
7. The backend streams the JSONL result content to the browser.
8. The frontend parses each line and extracts Markdown fragments.

### 5.3 Result rendering flow

1. `fetchJsonlAndProcess()` iterates over result lines.
2. Each successful result item contributes one or more markdown objects.
3. The UI updates `results` in memory.
4. A markdown render routine invokes `/ocr/pandoc` for each markdown chunk.
5. The returned HTML is inserted into the Results tab preview.

### 5.4 Export flow

1. User chooses a conversion format from the Downloads tab.
2. `handleConvert(item, format, e)` sends a POST request to `/ocr/convert`.
3. Backend calls the corresponding conversion path.
4. Server returns either:
   - HTML JSON payload, or
   - a binary file with a `Content-Disposition` attachment header
5. Browser downloads the generated document.

## 6. Data model

### Frontend state
The frontend stores state in the React hook and updates it as processing progresses.

Core records:
- `file`: uploaded browser file object
- `previewUrl`: generated object URL for image preview
- `model`: OCR model selected by the user
- `status`: queue/state string displayed to the user
- `jobId`: current PaddleOCR job identifier
- `results`: array of extracted result documents

Each item in `results` is shaped as:

```js
{
  markdownText: "...",
  markdownFilename: "result-1.md",
  markdownHtml: "<p>...</p>",
  raw: { ... } // upstream result payload
}
```

### Upstream OCR payloads
The OCR engine returns structured results in JSON and JSONL formats. The frontend expects result objects with fields such as:
- `result.layoutParsingResults`
- `result.markdownText`
- `resultUrl.jsonUrl`

This data is consumed dynamically and not strongly typed in the frontend.

## 7. Integration points

### PaddleOCR
The backend uses the external API endpoint:

```text
https://paddleocr.aistudio-app.com/api/v2/ocr/jobs
```

The service is used for:
- submitting a file and model configuration
- polling job status
- retrieving result URLs and generated output files

### Pandoc
Pandoc is invoked locally via shell script and is responsible for document conversions.

This is the main document transformation engine, and available conversion formats depend on the installed Pandoc capability and supporting tools.

## 8. Non-functional requirements

### Reliability
- The UI should gracefully handle failed submissions, polling errors, and invalid job payloads.
- Backend should return informative errors if upstream services fail.

### Usability
- Users can upload files directly or capture from camera.
- Status messages show current stage: submitting, pending, running, fetching, done, failed.
- Results are previewed immediately after extraction.

### Maintainability
- Core business logic is separated into `AppLogic.js` and `AppUI.js`.
- Backend routes are organized by responsibility and proxied via utility modules.

### Security
- The application stores an auth token server-side.
- The fetch route can retrieve arbitrary URLs and must be restricted in production.
- Uploaded files and generated temporary files should be managed carefully in deployment.

## 9. Risks and technical concerns

### 9.1 External dependency risk
The application depends heavily on:
- PaddleOCR availability
- Pandoc installation
- PDF conversion toolchain
- network connectivity to remote services

Failure in any of these dependencies affects OCR or export operations.

### 9.2 SSRF risk in `/ocr/fetch`
Because the route fetches arbitrary URLs supplied through the query string, an attacker could potentially trigger requests to internal services if not restricted.

Recommended mitigation:
- allow list destination domains
- validate URLs strictly
- disable remote fetch in production unless needed

### 9.3 Token handling
The app currently stores the PaddleOCR bearer token directly in source code. This is acceptable for demos but should be externalized and likely stored in environment variables in production.

### 9.4 Conversion failure modes
Some markdown conversions depend on parsing tables or generating PDFs.
If the input markdown is malformed or the conversion toolchain is missing, export will fail and should be handled gracefully.

## 10. Deployment model

The repository supports a simple production build flow using `build.sh`:

1. Install frontend dependencies.
2. Run `npm run build`.
3. Generate Flask templates and static assets.
4. Serve the React bundle from the Flask app.

This design keeps the application easy to deploy in a single-host environment while still allowing a frontend/backend split logically.

## 11. Suggested improvements

- Move sensitive configuration to environment variables.
- Add job persistence using a database or object store.
- Introduce user authentication and per-user file access.
- Add validation for file size and MIME type.
- Add automated tests for route execution and conversion logic.
- Add retry logic for polling and upstream requests.
- Introduce structured logging and monitoring.

## 12. Summary

This system is a practical full-stack OCR application that demonstrates how a modern React frontend can orchestrate asynchronous OCR processing with a backend proxy and document export pipeline. It bridges browser-based UX, Flask route handling, third-party OCR processing, and local conversion tooling, creating a compact but extensible workflow for document digitisation.

The architecture is intentionally lightweight, but it is also highly adaptable for future enhancements such as authentication, database-backed job tracking, and production-grade deployment controls.

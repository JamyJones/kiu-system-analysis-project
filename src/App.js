import React, { useState, useRef, useEffect } from "react";
import "bootstrap/dist/css/bootstrap.min.css";

// Replace this with your proxy URL (no trailing slash), e.g. "https://youruser.pythonanywhere.com"
const ROUTE_BASE = "/ocr";
const JOB_URL = `${ROUTE_BASE}/jobs`;
const FETCH_ENDPOINT = `${ROUTE_BASE}/fetch?url=`;

async function renderMdPandoc(md){
  try {
    const data ={mdText:md}
    const resp = await fetch(`${ROUTE_BASE}/pandoc`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Pandoc render failed: ${resp.status} ${txt}`);
    }
    const json = await resp.json();
    return json?.html ?? "";
  } catch (err) {
    return `<pre style=\"color:red\">Error rendering markdown: ${String(err.message)}</pre>`;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function fetchAsBlobUrl(proxyBaseFetchUrl, url) {
  // Use the proxy fetch endpoint to avoid CORS issues
  const proxyUrl = `${proxyBaseFetchUrl}${encodeURIComponent(url)}`;
  const resp = await fetch(proxyUrl);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  const blob = await resp.blob();
  return { blob, url: URL.createObjectURL(blob) };
}

export default function App() {
  const [isUrlMode, setIsUrlMode] = useState(true);
  const [fileUrl, setFileUrl] = useState("");
  const [file, setFile] = useState(null);
  const [model, setModel] = useState("PaddleOCR-VL-1.6");
  const [useDocOrientationClassify, setUseDocOrientationClassify] = useState(false);
  const [useDocUnwarping, setUseDocUnwarping] = useState(false);
  const [useChartRecognition, setUseChartRecognition] = useState(false);

  const [status, setStatus] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [results, setResults] = useState([]);
  const pollingRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, []);

  function log(msg) {
    // Keep UI clean: use console.log
    console.log(`${new Date().toLocaleTimeString()} - ${msg}`);
  }

  async function submitJob() {
    setStatus("submitting");
    setResults([]);
    setJobId(null);

    try {
      log("Submitting job...");
      let resp;

      const optionalPayload = {
        useDocOrientationClassify,
        useDocUnwarping,
        useChartRecognition,
      };

      if (isUrlMode) {
        if (!fileUrl) {
          log("Provide a file URL.");
          setStatus("error");
          return;
        }
        const body = {
          fileUrl,
          model,
          optionalPayload,
        };
        resp = await fetch(JOB_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        if (!file) {
          log("Select a local file to upload.");
          setStatus("error");
          return;
        }
        const form = new FormData();
        form.append("file", file);
        form.append("model", model);
        form.append("optionalPayload", JSON.stringify(optionalPayload));
        resp = await fetch(JOB_URL, {
          method: "POST",
          // Do NOT set Content-Type for FormData; browser will set it including boundary
          body: form,
        });
      }

      log(`Response status: ${resp.status}`);
      if (!resp.ok) {
        const txt = await resp.text();
        log(`Response content: ${txt}`);
        setStatus("error");
        return;
      }

      const data = await resp.json();
      const jid = data?.data?.jobId;
      if (!jid) {
        log("No jobId received in response.");
        setStatus("error");
        return;
      }

      log(`Job submitted successfully. job id: ${jid}`);
      setJobId(jid);
      setStatus("polling");
      pollJob(jid);
    } catch (err) {
      log("Submit error: " + err.message);
      setStatus("error");
    }
  }

  async function pollJob(jid) {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }

    const pollOnce = async () => {
      try {
        const resp = await fetch(`${JOB_URL}/${jid}`, {
          method: "GET",
        });
        if (!resp.ok) {
          log(`Job status fetch failed: ${resp.status}`);
          setStatus("error");
          return;
        }
        const j = await resp.json();
        const state = j?.data?.state;
        if (!state) {
          log("Unexpected job status payload.");
          setStatus("error");
          return;
        }

        if (state === "pending") {
          log("The current status of the job is pending");
          pollingRef.current = setTimeout(pollOnce, 5000);
        } else if (state === "running") {
          try {
            const prog = j?.data?.extractProgress || {};
            const totalPages = prog.totalPages;
            const extractedPages = prog.extractedPages;
            log(
              `Running: total pages: ${totalPages ?? "?"}, extracted: ${extractedPages ?? "?"}`
            );
          } catch {
            log("The current status of the job is running...");
          }
          pollingRef.current = setTimeout(pollOnce, 5000);
        } else if (state === "done") {
          log("Job completed.");
          const jsonlUrl = j?.data?.resultUrl?.jsonUrl;
          if (jsonlUrl) {
            log(`Result JSONL url: ${jsonlUrl}`);
            setStatus("fetching-result");
            await fetchJsonlAndProcess(jsonlUrl);
            setStatus("done");
          } else {
            log("Done but no result URL found.");
            setStatus("error");
          }
        } else if (state === "failed") {
          const errMsg = j?.data?.errorMsg || "unknown";
          log(`Job failed: ${errMsg}`);
          setStatus("failed");
        } else {
          log(`Unknown state: ${state}`);
          setStatus("error");
        }
      } catch (err) {
        log("Polling error: " + err.message);
        setStatus("error");
      }
    };

    pollOnce();
  }

  async function fetchJsonlAndProcess(jsonlUrl) {
    try {
      // Fetch JSONL via proxy to avoid CORS
      const proxyJsonlUrl = `${FETCH_ENDPOINT}${encodeURIComponent(jsonlUrl)}`;
      const resp = await fetch(proxyJsonlUrl);
      if (!resp.ok) {
        log(`Failed to download JSONL: ${resp.status}`);
        return;
      }
      const text = await resp.text();
      const lines = text.trim().split("\n").filter(Boolean);

      const outResults = [];
      let pageNum = 0;

      for (const line of lines) {
        const parsed = JSON.parse(line);
        const result = parsed.result;
        if (!result) continue;
        const layoutParsingResults = result.layoutParsingResults || [];

        for (const res of layoutParsingResults) {
          const markdownText = res?.markdown?.text ?? "";
          const markdownImages = res?.markdown?.images ?? {};
          const outputImages = res?.outputImages ?? {};

          const mdFilename = `doc_${pageNum}.md`;
          const mdBlob = new Blob([markdownText], { type: "text/markdown;charset=utf-8" });
          const mdBlobUrl = URL.createObjectURL(mdBlob);

          const imgs = [];
          for (const [imgPath, imgUrl] of Object.entries(markdownImages)) {
            try {
              const { blob, url } = await fetchAsBlobUrl(FETCH_ENDPOINT, imgUrl);
              imgs.push({ name: imgPath, url: imgUrl, blob, blobUrl: url });
            } catch (err) {
              log(`Failed to fetch markdown image ${imgUrl}: ${err.message}`);
              imgs.push({ name: imgPath, url: imgUrl, blob: null, blobUrl: null });
            }
          }

          const outImgs = [];
          for (const [imgName, imgUrl] of Object.entries(outputImages)) {
            try {
              const { blob, url } = await fetchAsBlobUrl(FETCH_ENDPOINT, imgUrl);
              outImgs.push({ name: imgName, url: imgUrl, blob, blobUrl: url });
            } catch (err) {
              log(`Failed to fetch output image ${imgUrl}: ${err.message}`);
              outImgs.push({ name: imgName, url: imgUrl, blob: null, blobUrl: null });
            }
          }

          outResults.push({
            markdownText,
            markdownFilename: mdFilename,
            markdownBlob:mdBlob,
            markdownBlobUrl: mdBlobUrl,
            images: imgs,
            outputImages: outImgs,
            markdownHtml: null,
          });

          log(`Processed page ${pageNum}`);
          pageNum += 1;
        }
      }

      setResults(outResults);

      // Render markdown -> HTML for each result (async, update as each completes)
      outResults.forEach((item, idx) => {
        renderMdPandoc(item.markdownText).then((html) => {
          setResults((prev) => {
            const copy = prev.slice();
            if (!copy[idx]) return prev; // guard
            copy[idx] = { ...copy[idx], markdownHtml: html };
            return copy;
          });
        });
      });

      log("All results processed.");
    } catch (err) {
      log("Result fetch/process error: " + err.message);
    }
  }

  function handleDownloadMarkdown(item) {
    const blob = new Blob([item.markdownText], { type: "text/markdown;charset=utf-8" });
    downloadBlob(blob, item.markdownFilename);
  }

  function handleDownloadImage(img) {
    if (img.blob) {
      downloadBlob(img.blob, img.name.replace(/\//g, "_"));
    } else if (img.url) {
      // fallback: open url in new tab (may be blocked by CORS if direct)
      window.open(img.url, "_blank");
    }
  }

  function isTopLevelTable(html) {
    if (!html) return false;
    const trimmed = html.trim().toLowerCase();
    return /^<\s*table\b/.test(trimmed);
  }

  async function handleConvert(item, format) {
    try {
      setStatus(`converting-${format}`);
      const body = { mdText: item.markdownText, format };
      const resp = await fetch(`${ROUTE_BASE}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        log(`Conversion failed: ${resp.status} ${txt}`);
        setStatus("error");
        return;
      }

      const blob = await resp.blob();
      // determine extension
      let ext = format;
      if (format === "xlsx") ext = "xlsx";
      if (format === "docx") ext = "docx";
      if (format === "pdf") ext = "pdf";
      const filename = item.markdownFilename.replace(/\.md$/, `.${ext}`);
      downloadBlob(blob, filename);
      setStatus("done");
    } catch (err) {
      log(`Conversion error: ${err.message}`);
      setStatus("error");
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#f0f6ff 0%, #ffffff 100%)', paddingTop: 20 }}>
      <div className="container my-4">
        <h3 style={{ marginBottom: 12 }}>PaddleOCR Job UI</h3>

        <div className="card mb-3 shadow-sm">
          <div className="card-body">
            <div className="mb-3 form-check form-switch">
              <input
                id="modeSwitch"
                className="form-check-input"
                type="checkbox"
                checked={isUrlMode}
                onChange={(e) => setIsUrlMode(e.target.checked)}
              />
              <label className="form-check-label" htmlFor="modeSwitch">
                URL Mode (toggle off for local file)
              </label>
            </div>

            {isUrlMode ? (
              <div className="mb-3">
                <label className="form-label">File URL</label>
                <input
                  className="form-control"
                  value={fileUrl}
                  onChange={(e) => setFileUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            ) : (
              <div className="mb-3">
                <label className="form-label">Select File</label>
                <input
                  className="form-control"
                  type="file"
                  onChange={(e) => setFile(e.target.files[0])}
                />
              </div>
            )}

            <div className="mb-3">
              <label className="form-label">Model</label>
              <input className="form-control" value={model} onChange={(e) => setModel(e.target.value)} />
            </div>

            <div className="mb-3">
              <div className="form-check">
                <input
                  className="form-check-input"
                  id="orient"
                  type="checkbox"
                  checked={useDocOrientationClassify}
                  onChange={(e) => setUseDocOrientationClassify(e.target.checked)}
                />
                <label className="form-check-label" htmlFor="orient">
                  useDocOrientationClassify
                </label>
              </div>
              <div className="form-check">
                <input
                  className="form-check-input"
                  id="unwarp"
                  type="checkbox"
                  checked={useDocUnwarping}
                  onChange={(e) => setUseDocUnwarping(e.target.checked)}
                />
                <label className="form-check-label" htmlFor="unwarp">
                  useDocUnwarping
                </label>
              </div>
              <div className="form-check">
                <input
                  className="form-check-input"
                  id="chart"
                  type="checkbox"
                  checked={useChartRecognition}
                  onChange={(e) => setUseChartRecognition(e.target.checked)}
                />
                <label className="form-check-label" htmlFor="chart">
                  useChartRecognition
                </label>
              </div>
            </div>

            <div className="d-flex gap-2">
              <button className="btn btn-primary" onClick={submitJob} disabled={status === "submitting" || status === "polling"}>
                Submit Job
              </button>
              <button
                className="btn btn-outline-secondary"
                onClick={() => {
                  setStatus(null);
                }}
              >
                Reset
              </button>
            </div>

            <div className="mt-3">
              {(status === 'submitting' || status === 'polling' || status === 'fetching-result' || (status && status.startsWith('converting'))) && (
                <div className="d-flex align-items-center gap-2 mt-2">
                  <div className="spinner-border text-primary" role="status" style={{ width: 20, height: 20 }}>
                    <span className="visually-hidden">Loading...</span>
                  </div>
                  <div style={{flex:1}}>
                    <div className="progress" style={{height:8}}>
                      <div className="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style={{width: '40%'}} />
                    </div>
                    <small className="text-muted">{status}</small>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>

        <div className="row">
          <div className="col-md-6">
            <h5>Status</h5>
            <div className="card mb-3">
              <div className="card-body" style={{ maxHeight: 300, overflow: "auto" }}>
                <p>
                  <strong>Current:</strong> {status ?? "idle"}
                </p>
                {jobId && (
                  <p>
                    <strong>JobId:</strong> {jobId}
                  </p>
                )}
                <hr />
                <div>
                  <small className="text-muted">Console logs are available in the browser developer console.</small>
                </div>
              </div>
            </div>
          </div>

          <div className="col-md-6">
            <h5>Results</h5>
            <div className="card mb-3">
              <div className="card-body" style={{ maxHeight: 300, overflow: "auto" }}>
                {results.length === 0 && <div>No results yet.</div>}
                {results.map((r, idx) => (
                  <div key={idx} className="mb-3">
                    <div className="d-flex justify-content-between align-items-start">
                      <div>
                        <strong>{r.markdownFilename}</strong>
                        <div style={{ whiteSpace: "pre-wrap", border: "1px solid #eee", padding: 8, marginTop: 6 }}>
                          {/* Render converted HTML (or a rendering placeholder) */}
                          <div dangerouslySetInnerHTML={{ __html: r.markdownHtml ?? "<em>Rendering...</em>" }} />
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 d-flex gap-2">
                      <button className="btn btn-sm btn-outline-primary" onClick={() => handleDownloadMarkdown(r)}>Download MD</button>
                      <button className="btn btn-sm btn-outline-success" onClick={() => handleConvert(r, 'html')}>Download HTML</button>
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => handleConvert(r, 'docx')}>Download DOCX</button>
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => handleConvert(r, 'pdf')}>Download PDF</button>
                      {isTopLevelTable(r.markdownHtml) && (
                        <button className="btn btn-sm btn-outline-warning" onClick={() => handleConvert(r, 'xlsx')}>Download Excel</button>
                      )}
                    </div>

                    {r.images.length > 0 && (
                      <div className="mt-2">
                        <strong>Markdown images</strong>
                        <div className="d-flex gap-2 flex-wrap mt-1">
                          {r.images.map((img, i) => (
                            <div key={i} style={{ width: 140 }}>
                              {img.blobUrl ? (
                                <img src={img.blobUrl} alt={img.name} style={{ width: "100%", height: "80px", objectFit: "cover" }} />
                              ) : (
                                <div style={{ width: "100%", height: 80, background: "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  No preview
                                </div>
                              )}
                              <div className="d-flex justify-content-between mt-1">
                                <small className="text-muted text-truncate" style={{ width: "60%" }}>{img.name}</small>
                                <button className="btn btn-sm btn-outline-secondary" onClick={() => handleDownloadImage(img)}>DL</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {r.outputImages.length > 0 && (
                      <div className="mt-2">
                        <strong>Output images</strong>
                        <div className="d-flex gap-2 flex-wrap mt-1">
                          {r.outputImages.map((img, i) => (
                            <div key={i} style={{ width: 140 }}>
                              {img.blobUrl ? (
                                <img src={img.blobUrl} alt={img.name} style={{ width: "100%", height: "80px", objectFit: "cover" }} />
                              ) : (
                                <div style={{ width: "100%", height: 80, background: "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  No preview
                                </div>
                              )}
                              <div className="d-flex justify-content-between mt-1">
                                <small className="text-muted text-truncate" style={{ width: "60%" }}>{img.name}</small>
                                <button className="btn btn-sm btn-outline-secondary" onClick={() => handleDownloadImage(img)}>DL</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

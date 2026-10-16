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

  const [log, setLog] = useState([]);
  const [status, setStatus] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [results, setResults] = useState([]);
  const pollingRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, []);

  function appendLog(msg) {
    setLog((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);
  }

  async function submitJob() {
    setLog([]);
    setStatus("submitting");
    setResults([]);
    setJobId(null);

    try {
      appendLog("Submitting job...");
      let resp;

      const optionalPayload = {
        useDocOrientationClassify,
        useDocUnwarping,
        useChartRecognition,
      };

      if (isUrlMode) {
        if (!fileUrl) {
          appendLog("Provide a file URL.");
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
          appendLog("Select a local file to upload.");
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

      appendLog(`Response status: ${resp.status}`);
      if (!resp.ok) {
        const txt = await resp.text();
        appendLog(`Response content: ${txt}`);
        setStatus("error");
        return;
      }

      const data = await resp.json();
      const jid = data?.data?.jobId;
      if (!jid) {
        appendLog("No jobId received in response.");
        setStatus("error");
        return;
      }

      appendLog(`Job submitted successfully. job id: ${jid}`);
      setJobId(jid);
      setStatus("polling");
      pollJob(jid);
    } catch (err) {
      appendLog("Submit error: " + err.message);
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
          appendLog(`Job status fetch failed: ${resp.status}`);
          setStatus("error");
          return;
        }
        const j = await resp.json();
        const state = j?.data?.state;
        if (!state) {
          appendLog("Unexpected job status payload.");
          setStatus("error");
          return;
        }

        if (state === "pending") {
          appendLog("The current status of the job is pending");
          pollingRef.current = setTimeout(pollOnce, 5000);
        } else if (state === "running") {
          try {
            const prog = j?.data?.extractProgress || {};
            const totalPages = prog.totalPages;
            const extractedPages = prog.extractedPages;
            appendLog(
              `Running: total pages: ${totalPages ?? "?"}, extracted: ${extractedPages ?? "?"}`
            );
          } catch {
            appendLog("The current status of the job is running...");
          }
          pollingRef.current = setTimeout(pollOnce, 5000);
        } else if (state === "done") {
          appendLog("Job completed.");
          const jsonlUrl = j?.data?.resultUrl?.jsonUrl;
          if (jsonlUrl) {
            appendLog(`Result JSONL url: ${jsonlUrl}`);
            setStatus("fetching-result");
            await fetchJsonlAndProcess(jsonlUrl);
            setStatus("done");
          } else {
            appendLog("Done but no result URL found.");
            setStatus("error");
          }
        } else if (state === "failed") {
          const errMsg = j?.data?.errorMsg || "unknown";
          appendLog(`Job failed: ${errMsg}`);
          setStatus("failed");
        } else {
          appendLog(`Unknown state: ${state}`);
          setStatus("error");
        }
      } catch (err) {
        appendLog("Polling error: " + err.message);
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
        appendLog(`Failed to download JSONL: ${resp.status}`);
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
              appendLog(`Failed to fetch markdown image ${imgUrl}: ${err.message}`);
              imgs.push({ name: imgPath, url: imgUrl, blob: null, blobUrl: null });
            }
          }

          const outImgs = [];
          for (const [imgName, imgUrl] of Object.entries(outputImages)) {
            try {
              const { blob, url } = await fetchAsBlobUrl(FETCH_ENDPOINT, imgUrl);
              outImgs.push({ name: imgName, url: imgUrl, blob, blobUrl: url });
            } catch (err) {
              appendLog(`Failed to fetch output image ${imgUrl}: ${err.message}`);
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

          appendLog(`Processed page ${pageNum}`);
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

      appendLog("All results processed.");
    } catch (err) {
      appendLog("Result fetch/process error: " + err.message);
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

  return (
    <div className="container my-4">
      <h3>PaddleOCR Job UI (React + Bootstrap)</h3>

      <div className="card mb-3">
        <div className="card-body">
          <div className="mb-3">
            <div className="alert alert-secondary">
              Token is provided server-side by your proxy. Set ROUTE_BASE at the top of this file to your proxy origin.
            </div>
          </div>

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
              className="btn btn-secondary"
              onClick={() => {
                setLog([]);
                setStatus(null);
              }}
            >
              Clear Log
            </button>
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
                {log.map((l, idx) => (
                  <div key={idx} style={{ fontFamily: "monospace", fontSize: 12 }}>
                    {l}
                  </div>
                ))}
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

      <div className="alert alert-info mt-3">
        Notes:
        <ul>
          <li>This app now expects a server-side proxy to handle Authorization and CORS.</li>
          <li>Set ROUTE_BASE at the top of src/App.js to your proxy origin (e.g. https://youruser.pythonanywhere.com).</li>
          <li>Ensure your proxy exposes: POST /api/jobs, GET /api/jobs/:jobId, GET /api/fetch?url=...</li>
        </ul>
      </div>
    </div>
  );
}

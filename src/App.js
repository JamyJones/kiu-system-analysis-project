import React, { useState, useRef } from "react";

const JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";

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

async function fetchAsBlobUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  const blob = await resp.blob();
  return { blob, url: URL.createObjectURL(blob) };
}

export default function App() {
  const [token, setToken] = useState("");
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

  function appendLog(msg) {
    setLog((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);
  }

  async function submitJob() {
    setLog([]);
    setStatus("submitting");
    setResults([]);
    setJobId(null);

    if (!token) {
      appendLog("Provide an Authorization token.");
      setStatus("error");
      return;
    }

    try {
      appendLog("Submitting job...");
      let resp;
      const headers = { Authorization: `bearer ${token}` };

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
        headers["Content-Type"] = "application/json";
        resp = await fetch(JOB_URL, {
          method: "POST",
          headers,
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
          headers: { Authorization: `bearer ${token}` }, // don't set Content-Type for FormData
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
      pollJob(jid, headers);
    } catch (err) {
      appendLog("Submit error: " + err.message);
      setStatus("error");
    }
  }

  async function pollJob(jid, headers) {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }

    const pollOnce = async () => {
      try {
        const resp = await fetch(`${JOB_URL}/${jid}`, {
          method: "GET",
          headers: headers,
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
      const resp = await fetch(jsonlUrl);
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
              const { blob, url } = await fetchAsBlobUrl(imgUrl);
              imgs.push({ name: imgPath, url: imgUrl, blob, blobUrl: url });
            } catch (err) {
              appendLog(`Failed to fetch markdown image ${imgUrl}: ${err.message}`);
              imgs.push({ name: imgPath, url: imgUrl, blob: null, blobUrl: null });
            }
          }

          const outImgs = [];
          for (const [imgName, imgUrl] of Object.entries(outputImages)) {
            try {
              const { blob, url } = await fetchAsBlobUrl(imgUrl);
              outImgs.push({ name: imgName, url: imgUrl, blob, blobUrl: url });
            } catch (err) {
              appendLog(`Failed to fetch output image ${imgUrl}: ${err.message}`);
              outImgs.push({ name: imgName, url: imgUrl, blob: null, blobUrl: null });
            }
          }

          outResults.push({
            markdownText,
            markdownFilename: mdFilename,
            markdownBlob,
            markdownBlobUrl: mdBlobUrl,
            images: imgs,
            outputImages: outImgs,
          });

          appendLog(`Processed page ${pageNum}`);
          pageNum += 1;
        }
      }

      setResults(outResults);
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
      window.open(img.url, "_blank");
    }
  }

  return (
    <div className="container my-4">
      <h3>PaddleOCR Job UI (React + Bootstrap)</h3>

      <div className="card mb-3">
        <div className="card-body">
          <div className="mb-3">
            <label className="form-label">Authorization Token</label>
            <input
              className="form-control"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste token here (consider using a proxy server in production)"
            />
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
                        {r.markdownText.slice(0, 200)}
                        {r.markdownText.length > 200 ? "..." : ""}
                      </div>
                    </div>
                    <div className="text-end">
                      <button className="btn btn-sm btn-outline-primary mb-2" onClick={() => handleDownloadMarkdown(r)}>
                        Download Markdown
                      </button>
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
          <li>This runs entirely in the browser. If the API does not allow cross-origin requests, the calls will fail — use a server-side proxy in that case.</li>
          <li>Do not store long-lived secrets (token) in a public client app — prefer a backend proxy that adds Authorization header securely.</li>
        </ul>
      </div>
    </div>
  );
}

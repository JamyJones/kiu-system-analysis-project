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
    return `<pre style="color:red">Error rendering markdown: ${String(err.message)}</pre>`;
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

export default function App() {
  const [file, setFile] = useState(null);
  const [model, setModel] = useState("PaddleOCR-VL-1.6");
  const [useDocOrientationClassify, setUseDocOrientationClassify] = useState(false);
  const [useDocUnwarping, setUseDocUnwarping] = useState(false);
  const [useChartRecognition, setUseChartRecognition] = useState(false);

  const [status, setStatus] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [results, setResults] = useState([]);
  const [activeTab, setActiveTab] = useState("input");
  const pollingRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, []);

  function log(msg) {
    console.log(`${new Date().toLocaleTimeString()} - ${msg}`);
  }

  function showUserMessage(message) {
    window.alert(message);
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

      if (!file) {
        log("No file selected.");
        showUserMessage("Please select a local file to upload.");
        setStatus(null);
        return;
      }

      const form = new FormData();
      form.append("file", file);
      form.append("model", model);
      form.append("optionalPayload", JSON.stringify(optionalPayload));
      resp = await fetch(JOB_URL, {
        method: "POST",
        body: form,
      });

      log(`Response status: ${resp.status}`);
      if (!resp.ok) {
        const txt = await resp.text();
        log(`Response content: ${txt}`);
        showUserMessage(`Submit failed: ${resp.status}. See console for details.`);
        setStatus(null);
        return;
      }

      const data = await resp.json();
      const jid = data?.data?.jobId;
      if (!jid) {
        log("No jobId received in response.");
        showUserMessage("Server did not return a job id. Please check the server logs.");
        setStatus(null);
        return;
      }

      log(`Job submitted successfully. job id: ${jid}`);
      setJobId(jid);
      setStatus("polling");
      setActiveTab("results");
      pollJob(jid);
    } catch (err) {
      log("Submit error: " + err.message);
      showUserMessage("Error submitting job. See console for details.");
      setStatus(null);
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
          showUserMessage(`Failed to fetch job status: ${resp.status}`);
          setStatus(null);
          return;
        }
        const j = await resp.json();
        const state = j?.data?.state;
        if (!state) {
          log("Unexpected job status payload.");
          showUserMessage("Unexpected job status payload from server.");
          setStatus(null);
          return;
        }

        if (state === "pending") {
          log("The current status of the job is pending");
          setStatus("pending: queued");
          pollingRef.current = setTimeout(pollOnce, 3000);
        } else if (state === "running") {
          try {
            const prog = j?.data?.extractProgress || {};
            const totalPages = prog.totalPages;
            const extractedPages = prog.extractedPages;
            log(`Running: total pages: ${totalPages ?? "?"}, extracted: ${extractedPages ?? "?"}`);
            setStatus(`running: extracted ${extractedPages ?? "?"}/${totalPages ?? "?"}`);
          } catch {
            log("The current status of the job is running...");
            setStatus("running");
          }
          pollingRef.current = setTimeout(pollOnce, 3000);
        } else if (state === "done") {
          log("Job completed.");
          const jsonlUrl = j?.data?.resultUrl?.jsonUrl;
          if (jsonlUrl) {
            log(`Result JSONL url: ${jsonlUrl}`);
            setStatus("fetching-result");
            await fetchJsonlAndProcess(jsonlUrl);
            setStatus("done");
            showUserMessage("Results ready.");
            setActiveTab("results");
          } else {
            log("Done but no result URL found.");
            showUserMessage("Job finished but no results found.");
            setStatus(null);
          }
        } else if (state === "failed") {
          const errMsg = j?.data?.errorMsg || "unknown";
          log(`Job failed: ${errMsg}`);
          showUserMessage(`Job failed: ${errMsg}`);
          setStatus("failed");
        } else {
          log(`Unknown state: ${state}`);
          setStatus(null);
        }
      } catch (err) {
        log("Polling error: " + err.message);
        showUserMessage("Error polling job status. See console for details.");
        setStatus(null);
      }
    };

    pollOnce();
  }

  async function fetchJsonlAndProcess(jsonlUrl) {
    try {
      const proxyJsonlUrl = `${FETCH_ENDPOINT}${encodeURIComponent(jsonlUrl)}`;
      const resp = await fetch(proxyJsonlUrl);
      if (!resp.ok) {
        log(`Failed to download JSONL: ${resp.status}`);
        showUserMessage(`Failed to download results: ${resp.status}`);
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

          const mdFilename = `doc_${pageNum}.md`;
          const mdBlob = new Blob([markdownText], { type: "text/markdown;charset=utf-8" });
          const mdBlobUrl = URL.createObjectURL(mdBlob);

          outResults.push({
            markdownText,
            markdownFilename: mdFilename,
            markdownBlob: mdBlob,
            markdownBlobUrl: mdBlobUrl,
            markdownHtml: null,
          });

          log(`Processed page ${pageNum}`);
          pageNum += 1;
        }
      }

      setResults(outResults);

      outResults.forEach((item, idx) => {
        renderMdPandoc(item.markdownText).then((html) => {
          setResults((prev) => {
            const copy = prev.slice();
            if (!copy[idx]) return prev;
            copy[idx] = { ...copy[idx], markdownHtml: html };
            return copy;
          });
        });
      });

      log("All results processed.");
    } catch (err) {
      log("Result fetch/process error: " + err.message);
      showUserMessage("Error processing results. See console for details.");
    }
  }

  function handleDownloadMarkdown(item) {
    const blob = new Blob([item.markdownText], { type: "text/markdown;charset=utf-8" });
    downloadBlob(blob, item.markdownFilename);
  }

  function isTopLevelTable(html) {
    if (!html) return false;
    const trimmed = html.trim().toLowerCase();
    return /^<\s*table\b/.test(trimmed);
  }

  async function handleConvert(item, format, e) {
    try {
      if (e && e.currentTarget) {
        e.currentTarget.classList.add("shake");
        e.currentTarget.addEventListener("animationend", () => e.currentTarget.classList.remove("shake"), { once: true });
      }

      setStatus(`converting: ${format}`);
      const body = { mdText: item.markdownText, format };
      const resp = await fetch(`${ROUTE_BASE}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        log(`Conversion failed: ${resp.status} ${txt}`);
        showUserMessage(`Conversion failed: ${resp.status}`);
        setStatus(null);
        return;
      }

      const blob = await resp.blob();
      let ext = format;
      if (format === "xlsx") ext = "xlsx";
      if (format === "docx") ext = "docx";
      if (format === "pdf") ext = "pdf";
      const filename = item.markdownFilename.replace(/\.md$/, `.${ext}`);
      downloadBlob(blob, filename);
      setStatus("done");
    } catch (err) {
      log(`Conversion error: ${err.message}`);
      showUserMessage("Conversion error. See console for details.");
      setStatus(null);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #eef5ff 0%, #f6f9ff 35%, #eef8f5 100%)', color: '#1f2937', fontFamily: "Inter, 'Segoe UI', Roboto, 'Helvetica Neue', Arial" }}>
      <style>{`
        .app-container { padding-top: 20px; }
        .card { border-radius: 14px; border: 1px solid rgba(148,163,184,0.25); background: rgba(255,255,255,0.88); }
        .nav-tabs .nav-link { color: #334155; }
        .nav-tabs .nav-link.active { background: linear-gradient(90deg,#edf4ff,#ffffff); border-color: #dfeafc; color: #0f172a; }
        .tab-panel { min-height: 420px; }
        .download-stack { display:flex; flex-direction:column; gap:12px; align-items:center; justify-content:center; }
        .download-btn { min-width: 220px; border-radius: 12px; transition: transform .18s ease, box-shadow .18s ease; }
        .download-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(37, 99, 235, 0.08); }
        .download-btn:active { transform: scale(.98); }
        .shake { animation: shake 0.4s; }
        @keyframes shake { 0%{ transform: translateX(0);} 25%{ transform: translateX(-6px);} 50%{ transform: translateX(6px);} 75%{ transform: translateX(-4px);} 100%{ transform: translateX(0);} }
        .centered { display:flex; align-items:center; justify-content:center; }
        .result-card { max-height: 60vh; overflow:auto; }
        .status-row { display:flex; align-items:center; gap: 12px; }
        .muted { color:#475569; }
      `}</style>

      <div className="container app-container">
        <h3 style={{ marginBottom: 12, color: '#0f172a' }}>PaddleOCR Job UI</h3>

        <div className="card mb-3 shadow-sm">
          <div className="card-body">
            <ul className="nav nav-tabs mb-3" role="tablist">
              <li className="nav-item">
                <button className={`nav-link ${activeTab === 'input' ? 'active' : ''}`} onClick={() => setActiveTab('input')}>Input</button>
              </li>
              <li className="nav-item">
                <button className={`nav-link ${activeTab === 'results' ? 'active' : ''}`} onClick={() => setActiveTab('results')}>Results</button>
              </li>
              <li className="nav-item">
                <button className={`nav-link ${activeTab === 'downloads' ? 'active' : ''}`} onClick={() => setActiveTab('downloads')}>Downloads</button>
              </li>
            </ul>

            <div className="tab-panel">
              {activeTab === 'input' && (
                <div>
                  <div className="mb-3">
                    <label className="form-label" style={{ color: '#334155' }}>Select File</label>
                    <input
                      className="form-control"
                      type="file"
                      onChange={(e) => setFile(e.target.files[0])}
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label" style={{ color: '#334155' }}>Model</label>
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
                      <label className="form-check-label" htmlFor="orient" style={{ color: '#334155' }}>
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
                      <label className="form-check-label" htmlFor="unwarp" style={{ color: '#334155' }}>
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
                      <label className="form-check-label" htmlFor="chart" style={{ color: '#334155' }}>
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
                        setFile(null);
                        setResults([]);
                        setJobId(null);
                        showUserMessage("Reset complete.");
                      }}
                    >
                      Reset
                    </button>
                  </div>

                  <div className="mt-3">
                    {status && (status === 'submitting' || status.startsWith('pending') || status.startsWith('running') || status === 'fetching-result' || status.startsWith('converting')) ? (
                      <div className="status-row mt-2">
                        <div className="spinner-border text-primary" role="status" style={{ width: 20, height: 20 }}>
                          <span className="visually-hidden">Loading...</span>
                        </div>
                        <div>
                          <small className="text-muted">{status}</small>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              {activeTab === 'results' && (
                <div>
                  <div className="mb-3">
                    <h6 style={{ marginBottom: 8, color: '#0f172a' }}>Current status: <span className="muted">{status ?? 'idle'}</span></h6>
                    {jobId && (<div style={{ color: '#334155' }}><strong>JobId:</strong> {jobId}</div>)}
                  </div>

                  <div className="card result-card">
                    <div className="card-body">
                      {results.length === 0 && <div style={{ color: '#475569' }}>No results yet.</div>}
                      {results.map((r, idx) => (
                        <div key={idx} className="mb-3">
                          <strong style={{ color: '#0f172a' }}>{r.markdownFilename}</strong>
                          <div style={{ whiteSpace: "pre-wrap", padding: 8, marginTop: 6, color: '#1f2937' }}>
                            <div dangerouslySetInnerHTML={{ __html: r.markdownHtml ?? "<em>Rendering...</em>" }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'downloads' && (
                <div className="centered" style={{ padding: 18 }}>
                  <div className="download-stack">
                    {results.length === 0 && <div style={{ color: '#475569' }}>No results to download.</div>}
                    {results.map((r, idx) => (
                      <div key={idx} style={{ width: '100%', display:'flex', flexDirection:'column', alignItems:'center', gap: 12 }}>
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>{r.markdownFilename}</div>
                        <div className="d-flex flex-column align-items-center" style={{ width: '100%', gap: 10 }}>
                          <button className="btn btn-outline-primary download-btn" onClick={(e) => handleConvert(r, 'html', e)}>
                            Download HTML
                          </button>
                          <button className="btn btn-outline-secondary download-btn" onClick={(e) => handleConvert(r, 'docx', e)}>
                            Download DOCX
                          </button>
                          <button className="btn btn-outline-danger download-btn" onClick={(e) => handleConvert(r, 'pdf', e)}>
                            Download PDF
                          </button>
                          {isTopLevelTable(r.markdownHtml) && (
                            <button className="btn btn-outline-warning download-btn" onClick={(e) => handleConvert(r, 'xlsx', e)}>
                              Download Excel
                            </button>
                          )}
                          <button className="btn btn-outline-success download-btn" onClick={() => handleDownloadMarkdown(r)}>
                            Download Markdown
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="row">
          <div className="col-md-6">
            <h5 style={{ color: '#0f172a' }}>Status</h5>
            <div className="card mb-3">
              <div className="card-body" style={{ maxHeight: 200, overflow: "auto", color: '#1f2937' }}>
                <p><strong>Current:</strong> {status ?? "idle"}</p>
                {jobId && <p><strong>JobId:</strong> {jobId}</p>}
                <hr />
                <div><small className="text-muted">Console logs are available in the browser developer console.</small></div>
              </div>
            </div>
          </div>

          <div className="col-md-6">
            <h5 style={{ color: '#0f172a' }}>Results preview</h5>
            <div className="card mb-3">
              <div className="card-body" style={{ maxHeight: 200, overflow: "auto", color: '#1f2937' }}>
                {results.length === 0 && <div style={{ color: '#475569' }}>No results yet.</div>}
                {results.map((r, idx) => (
                  <div key={idx} className="mb-3">
                    <strong>{r.markdownFilename}</strong>
                    <div style={{ whiteSpace: "pre-wrap", padding: 8, marginTop: 6 }}>
                      <div dangerouslySetInnerHTML={{ __html: r.markdownHtml ?? "<em>Rendering...</em>" }} />
                    </div>
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

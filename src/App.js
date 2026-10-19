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
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('ui-dark') === '1';
    } catch { return false }
  });
  const [showFireworks, setShowFireworks] = useState(false);

  const pollingRef = useRef(null);
  const cameraInputRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem('ui-dark', dark ? '1' : '0'); } catch {}
  }, [dark]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, []);

  useEffect(() => {
    if (showFireworks) {
      const t = setTimeout(() => setShowFireworks(false), 4000);
      return () => clearTimeout(t);
    }
  }, [showFireworks]);

  function log(msg) {
    console.log(`${new Date().toLocaleTimeString()} - ${msg}`);
  }

  function showUserMessage(message) {
    // Friendly mobile-first UX: use alert for now
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
        showUserMessage(`Submit failed: ${resp.status}.`);
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
            setShowFireworks(true);
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
    <div className={dark ? 'app-root dark' : 'app-root'}>
      <style>{`
        :root{
          --bg: #e8f0ff; /* light background solid */
          --card: #ffffff;
          --text: #0f172a;
          --muted: #475569;
          --accent: #2563eb; /* blue */
          --accent-2: #06b6d4;
          --tab-bg: #f1f5f9;
          --tab-active: linear-gradient(90deg,#60a5fa,#7dd3fc);
          --material-shadow: 0 6px 18px rgba(15,23,42,0.12);
        }
        .dark{
          --bg: #0f172a; /* solid dark */
          --card: rgba(255,255,255,0.03);
          --text: #e6eef8;
          --muted: #94a3b8;
          --accent: #60a5fa;
          --accent-2: #38bdf8;
          --tab-bg: rgba(255,255,255,0.02);
          --tab-active: linear-gradient(90deg,#0ea5e9,#7c3aed);
          --material-shadow: 0 8px 30px rgba(2,6,23,0.6);
        }

        .app-root{ min-height:100vh; background:var(--bg); color:var(--text); font-family: Inter, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; padding:18px; }
        .container-mobile{ max-width:900px; margin:0 auto; }
        h3.title { text-align:center; font-family: 'Segoe Script', 'Bradley Hand', 'Segoe UI', cursive; font-size:1.6rem; margin-bottom:12px; }

        .card { border-radius:14px; border: none; background: var(--card); box-shadow: var(--material-shadow); }
        .nav-tabs{ display:flex; gap:6px; padding:8px; background:transparent; border-bottom:none; }
        .nav-tabs .nav-item{ flex:1; }
        .nav-tabs .nav-link{ display:flex; align-items:center; justify-content:center; padding:10px 6px; border-radius:10px; background:var(--tab-bg); color:var(--text); border:none; font-weight:600; }
        .nav-tabs .nav-link.active{ background: var(--tab-active); color:#04263a; box-shadow: 0 6px 20px rgba(2,6,23,0.08); }

        .tab-panel{ padding:8px 6px; }
        .form-control[readonly]{ background:transparent; border:1px dashed rgba(0,0,0,0.06); }

        .material-btn{ display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:10px 14px; border-radius:12px; border:none; cursor:pointer; box-shadow: 0 6px 14px rgba(2,6,23,0.08); transition: transform .12s ease, box-shadow .12s ease, opacity .12s; background: linear-gradient(180deg, #fff 0%, #f8fbff 100%); }
        .material-btn:active{ transform: translateY(2px) scale(.995); box-shadow: 0 4px 10px rgba(2,6,23,0.06); }
        .material-btn.primary{ background: linear-gradient(90deg,var(--accent),var(--accent-2)); color: white; }
        .material-btn.outline{ background:transparent; border:1px solid rgba(15,23,42,0.06); }

        .download-btn{ min-width: 220px; border-radius: 12px; }
        .shake { animation: shake 0.4s; }
        @keyframes shake { 0%{ transform: translateX(0);} 25%{ transform: translateX(-6px);} 50%{ transform: translateX(6px);} 75%{ transform: translateX(-4px);} 100%{ transform: translateX(0);} }

        .camera-btn{ display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border-radius:10px; background: rgba(2,6,23,0.06); border:none; }

        .status-chip{ display:inline-block; padding:8px 10px; background: rgba(2,6,23,0.04); border-radius:999px; font-weight:600; }

        /* fireworks */
        .fireworks-wrap{ pointer-events:none; position:fixed; left:0; top:0; width:100%; height:100%; z-index:9999; overflow:hidden; }
        .firework{ position:absolute; width:12px; height:12px; border-radius:50%; opacity:0; transform:scale(0); }

      `}</style>

      {showFireworks && (
        <div className="fireworks-wrap">
          {/* create many bursts positioned randomly */}
          {Array.from({length:12}).map((_,i)=>{
            const left = Math.random()*100;
            const top = Math.random()*60 + 10;
            const clr = ['#f97316','#fb7185','#60a5fa','#34d399','#f43f5e','#e879f9'][Math.floor(Math.random()*6)];
            const delay = Math.random()*0.8;
            const duration = 1 + Math.random()*1.2;
            const style = { left:`${left}%`, top:`${top}%`, background:clr, animation:`fw ${duration}s ${delay}s ease-out forwards` };
            return <span key={i} className="firework" style={style}></span>;
          })}

          <style>{`
            @keyframes fw{ 0%{ opacity:1; transform:scale(0); } 60%{ opacity:1; transform:scale(1.6); } 100%{ opacity:0; transform:scale(2.6) translateY(-60px); } }
          `}</style>
        </div>
      )}

      <div className="container-mobile">
        <h3 className="title">handwritting digitiser</h3>

        <div className="card mb-3">
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
                    <label className="form-label" style={{ color: 'var(--text)' }}>Select File</label>
                    <input
                      className="form-control"
                      type="file"
                      onChange={(e) => setFile(e.target.files[0])}
                    />
                  </div>

                  <div className="mb-3 d-flex gap-2" style={{ alignItems:'center' }}>
                    <input ref={cameraInputRef} style={{display:'none'}} accept="image/*" capture="environment" id="cameraInput" type="file" onChange={(e)=> setFile(e.target.files[0])} />
                    <button className="camera-btn" onClick={()=> cameraInputRef.current && cameraInputRef.current.click()} aria-label="Capture from camera">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 17a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M20 7h-3.2l-1.4-1.8A2 2 0 0013.8 4H10.2a2 2 0 00-1.6.8L7.2 7H4a2 2 0 00-2 2v8a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Capture
                    </button>

                    <div style={{ flex:1 }} />

                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <label style={{ fontSize:12, color:'var(--muted)' }}>Dark</label>
                      <div style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
                        <input id="darkToggle" type="checkbox" checked={dark} onChange={(e)=> setDark(e.target.checked)} />
                      </div>
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label" style={{ color: 'var(--text)' }}>Model</label>
                    <input className="form-control" value={model} onChange={(e) => setModel(e.target.value)} readOnly />
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
                      <label className="form-check-label" htmlFor="orient" style={{ color: 'var(--text)' }}>
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
                      <label className="form-check-label" htmlFor="unwarp" style={{ color: 'var(--text)' }}>
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
                      <label className="form-check-label" htmlFor="chart" style={{ color: 'var(--text)' }}>
                        useChartRecognition
                      </label>
                    </div>
                  </div>

                  <div className="d-flex gap-2" style={{ marginBottom:12 }}>
                    <button className="material-btn primary" onClick={submitJob} disabled={status === "submitting" || status === "polling"}>
                      Submit Job
                    </button>
                    <button
                      className="material-btn outline"
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

                  <div className="mb-2">
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div>
                        <small className="muted">Status:</small>
                        <div style={{ marginTop:6 }}><span className="status-chip">{status ?? 'idle'}</span></div>
                      </div>

                      <div style={{ textAlign:'right' }}>
                        {jobId && (<div style={{ color: 'var(--muted)' }}><strong>JobId:</strong> {jobId}</div>)}
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {activeTab === 'results' && (
                <div>
                  <div className="mb-3">
                    <h6 style={{ marginBottom: 8, color: 'var(--text)' }}>Current status: <span style={{ color:'var(--muted)' }}>{status ?? 'idle'}</span></h6>
                    {jobId && (<div style={{ color: 'var(--muted)' }}><strong>JobId:</strong> {jobId}</div>)}
                  </div>

                  <div className="card result-card">
                    <div className="card-body">
                      {results.length === 0 && <div style={{ color: 'var(--muted)' }}>No results yet.</div>}
                      {results.map((r, idx) => (
                        <div key={idx} className="mb-3">
                          <strong style={{ color: 'var(--text)' }}>{r.markdownFilename}</strong>
                          <div style={{ whiteSpace: "pre-wrap", padding: 8, marginTop: 6, color: 'var(--text)' }}>
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
                    {results.length === 0 && <div style={{ color: 'var(--muted)' }}>No results to download.</div>}
                    {results.map((r, idx) => (
                      <div key={idx} style={{ width: '100%', display:'flex', flexDirection:'column', alignItems:'center', gap: 12 }}>
                        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{r.markdownFilename}</div>
                        <div className="d-flex flex-column align-items-center" style={{ width: '100%', gap: 10 }}>
                          <button className="material-btn outline download-btn" onClick={(e) => handleConvert(r, 'html', e)}>
                            Download HTML
                          </button>
                          <button className="material-btn outline download-btn" onClick={(e) => handleConvert(r, 'docx', e)}>
                            Download DOCX
                          </button>
                          <button className="material-btn outline download-btn" onClick={(e) => handleConvert(r, 'pdf', e)}>
                            Download PDF
                          </button>
                          {isTopLevelTable(r.markdownHtml) && (
                            <button className="material-btn outline download-btn" onClick={(e) => handleConvert(r, 'xlsx', e)}>
                              Download Excel
                            </button>
                          )}
                          <button className="material-btn primary download-btn" onClick={() => handleDownloadMarkdown(r)}>
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

        {/* Removed old bottom status/result preview to improve mobile-first layout */}

      </div>

    </div>
  );
}

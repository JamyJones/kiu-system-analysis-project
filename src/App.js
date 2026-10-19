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
  const [previewUrl, setPreviewUrl] = useState(null);
  const [model, setModel] = useState("PaddleOCR-VL-1.6");
  const [useDocOrientationClassify, setUseDocOrientationClassify] = useState(false);
  const [useDocUnwarping, setUseDocUnwarping] = useState(false);
  const [useChartRecognition, setUseChartRecognition] = useState(false);

  const [status, setStatus] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [results, setResults] = useState([]);
  const [activeTab, setActiveTab] = useState("input");
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('ui-dark') === '1'; } catch { return false }
  });
  const [showFireworks, setShowFireworks] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  const pollingRef = useRef(null);
  const cameraInputRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem('ui-dark', dark ? '1' : '0'); } catch {}
  }, [dark]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (showFireworks) {
      const t = setTimeout(() => setShowFireworks(false), 4000);
      return () => clearTimeout(t);
    }
  }, [showFireworks]);

  useEffect(() => {
    if (file) {
      try {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      } catch {}
      if (file.type && file.type.startsWith('image/')) {
        const u = URL.createObjectURL(file);
        setPreviewUrl(u);
      } else {
        setPreviewUrl(null);
      }
    } else {
      if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    }
  }, [file]);

  function log(msg) { console.log(`${new Date().toLocaleTimeString()} - ${msg}`); }
  function showUserMessage(message) { window.alert(message); }

  async function submitJob() {
    setStatus("submitting");
    setResults([]);
    setJobId(null);

    try {
      log("Submitting job...");

      const optionalPayload = { useDocOrientationClassify, useDocUnwarping, useChartRecognition };

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
      const resp = await fetch(JOB_URL, { method: "POST", body: form });

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
    if (pollingRef.current) { clearTimeout(pollingRef.current); pollingRef.current = null; }

    const pollOnce = async () => {
      try {
        const resp = await fetch(`${JOB_URL}/${jid}`, { method: "GET" });
        if (!resp.ok) { log(`Job status fetch failed: ${resp.status}`); showUserMessage(`Failed to fetch job status: ${resp.status}`); setStatus(null); return; }
        const j = await resp.json();
        const state = j?.data?.state;
        if (!state) { log("Unexpected job status payload."); showUserMessage("Unexpected job status payload from server."); setStatus(null); return; }

        if (state === "pending") {
          setStatus("pending: queued");
          pollingRef.current = setTimeout(pollOnce, 2000);
        } else if (state === "running") {
          try {
            const prog = j?.data?.extractProgress || {};
            const totalPages = prog.totalPages;
            const extractedPages = prog.extractedPages;
            setStatus(`running: extracted ${extractedPages ?? "?"}/${totalPages ?? "?"}`);
          } catch { setStatus("running"); }
          pollingRef.current = setTimeout(pollOnce, 2000);
        } else if (state === "done") {
          const jsonlUrl = j?.data?.resultUrl?.jsonUrl;
          if (jsonlUrl) {
            setStatus("fetching-result");
            await fetchJsonlAndProcess(jsonlUrl);
            setStatus("done");
            setShowFireworks(true);
            showUserMessage("Results ready.");
            setActiveTab("results");
          } else {
            showUserMessage("Job finished but no results found.");
            setStatus(null);
          }
        } else if (state === "failed") {
          const errMsg = j?.data?.errorMsg || "unknown";
          setStatus("failed");
          showUserMessage(`Job failed: ${errMsg}`);
        } else { setStatus(null); }
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
      if (!resp.ok) { showUserMessage(`Failed to download results: ${resp.status}`); return; }
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
          outResults.push({ markdownText, markdownFilename: mdFilename, markdownBlob: mdBlob, markdownHtml: null });
          pageNum += 1;
        }
      }

      setResults(outResults);
      outResults.forEach((item, idx) => {
        renderMdPandoc(item.markdownText).then((html) => {
          setResults(prev => { const copy = prev.slice(); if (!copy[idx]) return prev; copy[idx] = { ...copy[idx], markdownHtml: html }; return copy; });
        });
      });
    } catch (err) { log("Result fetch/process error: " + err.message); showUserMessage("Error processing results. See console for details."); }
  }

  function handleDownloadMarkdown(item) { const blob = new Blob([item.markdownText], { type: "text/markdown;charset=utf-8" }); downloadBlob(blob, item.markdownFilename); }

  function isTopLevelTable(html) { if (!html) return false; const trimmed = html.trim().toLowerCase(); return /^<\s*table\b/.test(trimmed); }

  async function handleConvert(item, format, e) {
    try {
      if (e && e.currentTarget) {
        e.currentTarget.classList.add("shake");
        e.currentTarget.addEventListener("animationend", () => e.currentTarget.classList.remove("shake"), { once: true });
      }

      setStatus(`converting: ${format}`);
      const body = { mdText: item.markdownText, format };
      const resp = await fetch(`${ROUTE_BASE}/convert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!resp.ok) { const txt = await resp.text(); showUserMessage(`Conversion failed: ${resp.status}`); setStatus(null); return; }
      const blob = await resp.blob();
      const ext = format;
      const filename = item.markdownFilename.replace(/\.md$/, `.${ext}`);
      downloadBlob(blob, filename);
      setStatus("done");
    } catch (err) { log(`Conversion error: ${err.message}`); showUserMessage("Conversion error. See console for details."); setStatus(null); }
  }

  const models = ["PaddleOCR-VL-1.6", "PaddleOCR-Card-1.0", "PaddleOCR-Table-1.2"];

  return (
    <div className={dark ? 'app-root dark' : 'app-root'}>
      <style>{`
        :root{
          --bg1: #f7fbff;
          --bg2: #e6f0ff;
          --card: #ffffff;
          --text: #0f172a;
          --muted: #475569;
          --accent: #2563eb;
          --accent-2: #06b6d4;
          --tab-bg: #f1f5f9;
          --tab-active: linear-gradient(90deg,#60a5fa,#7dd3fc);
          --material-shadow: 0 6px 18px rgba(15,23,42,0.12);
          --submit-grad: linear-gradient(90deg,var(--accent),var(--accent-2));
        }
        .dark{
          --bg1: #071024;
          --bg2: #0b1220;
          --card: rgba(255,255,255,0.03);
          --text: #e6eef8;
          --muted: #94a3b8;
          --accent: #60a5fa;
          --accent-2: #7c3aed;
          --tab-bg: rgba(255,255,255,0.02);
          --tab-active: linear-gradient(90deg,#0ea5e9,#7c3aed);
          --material-shadow: 0 8px 30px rgba(2,6,23,0.6);
          --submit-grad: linear-gradient(90deg,#0ea5e9,#7c3aed);
        }

        /* animated gradient background */
        .app-root{ min-height:100vh; color:var(--text); font-family: Inter, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; padding:12px; overflow-x:hidden; }
        .bg-animated{ position:fixed; left:0; top:0; width:100%; height:100%; z-index:-2; background: linear-gradient(120deg,var(--bg1),var(--bg2)); background-size:400% 400%; animation: gradientAnim 20s ease infinite; }
        .dark .bg-animated{ background: linear-gradient(120deg,var(--bg1),var(--bg2)); background-size:200% 200%; animation: none; }
        @keyframes gradientAnim{ 0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%} }

        .container-mobile{ max-width:920px; margin:0 auto; position:relative; z-index:1; }

        h1.title { text-align:center; font-family: 'Segoe Script', 'Bradley Hand', 'Segoe UI', cursive; font-size:2.6rem; line-height:1; margin:6px 0 14px; font-weight:700; text-transform:capitalize; }
        h1.title span { display:block; }

        .topbar{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
        .top-left{ display:flex; align-items:center; gap:10px; }
        .icon-btn{ background:transparent; border:none; color:var(--text); padding:8px; border-radius:10px; cursor:pointer; }
        .icon-btn:active{ transform:translateY(1px); }

        /* simple offcanvas/modal */
        .offcanvas{ position:fixed; left:0; top:0; width:320px; max-width:90%; height:100%; background:var(--card); color:var(--text); box-shadow:var(--material-shadow); transform:translateX(-110%); transition:transform .28s ease; z-index:2000; padding:18px; }
        .offcanvas.show{ transform:translateX(0%); }
        .offcanvas h4{ margin-top:0; }

        .dark-toggle{ display:inline-flex; align-items:center; gap:8px; }
        .switch{ width:46px; height:26px; background:rgba(15,23,42,0.08); border-radius:999px; position:relative; cursor:pointer; }
        .switch .knob{ position:absolute; top:3px; left:3px; width:20px; height:20px; background:white; border-radius:50%; transition:left .18s ease, background .18s ease; }
        .dark .switch{ background:rgba(255,255,255,0.06); }
        .dark .switch .knob{ left:23px; background:#fff; }

        .card { border-radius:14px; border:none; background: var(--card); box-shadow: var(--material-shadow); }
        .nav-tabs{ display:flex; gap:8px; padding:8px; background:transparent; border-bottom:none; }
        .nav-tabs .nav-item{ flex:1; }
        .nav-tabs .nav-link{ display:flex; align-items:center; justify-content:center; padding:12px 6px; border-radius:12px; background:var(--tab-bg); color:var(--text); border:none; font-weight:700; }
        .nav-tabs .nav-link.active{ background: var(--tab-active); color:#04263a; box-shadow: 0 8px 26px rgba(2,6,23,0.08); }

        .tab-panel{ padding:12px; display:flex; justify-content:center; }
        .tab-inner{ width:100%; max-width:640px; }

        label.form-label{ display:flex; align-items:center; gap:8px; font-weight:700; color:var(--text); }
        .upload-icon{ width:18px; height:18px; }

        .centered-col{ display:flex; flex-direction:column; align-items:center; }
        .form-control[readonly]{ background:transparent; border:1px dashed rgba(0,0,0,0.06); color:var(--text); }

        .material-btn{ display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:12px 16px; border-radius:12px; border:none; cursor:pointer; box-shadow: 0 8px 20px rgba(2,6,23,0.08); transition: transform .12s ease, box-shadow .12s ease, opacity .12s; background: var(--submit-grad); color: white; font-weight:700; }
        .material-btn.outline{ background:transparent; color:var(--text); border:1px solid rgba(15,23,42,0.06); box-shadow:none; }
        .material-btn:active{ transform: translateY(2px) scale(.995); }

        .camera-btn{ display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border-radius:10px; background: rgba(2,6,23,0.06); border:none; color:var(--text); }

        .status-row{ display:flex; align-items:center; gap:12px; }
        .muted{ color:var(--muted); }

        /* rotating gear spinner */
        .spinner-wheel{ width:26px; height:26px; display:inline-block; }
        .spin{ animation: spin 1s linear infinite; }
        @keyframes spin{ to{ transform: rotate(360deg); } }

        /* downloads buttons fix */
        .download-stack{ display:flex; flex-direction:column; gap:10px; align-items:center; }

        /* preview thumbnail */
        .thumb{ width:84px; height:84px; object-fit:cover; border-radius:10px; border:1px solid rgba(0,0,0,0.06); }
        .file-chip{ display:inline-flex; gap:8px; align-items:center; padding:8px 10px; border-radius:999px; background:rgba(15,23,42,0.04); color:var(--text); }

        /* fireworks */
        .fireworks-wrap{ pointer-events:none; position:fixed; left:0; top:0; width:100%; height:100%; z-index:9999; overflow:hidden; }
        .firework{ position:absolute; width:12px; height:12px; border-radius:50%; opacity:0; transform:scale(0); }

        /* stars for dark mode */
        .stars-wrap{ pointer-events:none; position:fixed; left:0; top:0; width:100%; height:100%; z-index:-1; overflow:hidden; }
        .star{ position:absolute; width:3px; height:3px; border-radius:50%; background:white; opacity:0.9; animation: twinkle 3s infinite; }
        @keyframes twinkle{ 0%{opacity:0.2}50%{opacity:1}100%{opacity:0.2} }

        @media (max-width:600px){ h1.title{ font-size:2rem; } .nav-tabs .nav-link{ padding:10px 4px; font-size:14px; } }
      `}</style>

      <div className="bg-animated" />

      {/* stars only in dark mode */}
      {dark && (
        <div className="stars-wrap" aria-hidden>
          {Array.from({length:40}).map((_,i)=>{
            const left = Math.random()*100; const top = Math.random()*100; const delay = Math.random()*4; const dur = 2+Math.random()*3;
            const style = { left:`${left}%`, top:`${top}%`, animationDelay:`${delay}s`, animationDuration:`${dur}s`, opacity:Math.random()*.9+.1 };
            return <span key={i} className="star" style={style} />;
          })}
        </div>
      )}

      <div className="container-mobile">
        <div className="topbar">
          <div className="top-left">
            <button className="icon-btn" aria-label="About" onClick={() => setShowAbout(true)} title="About">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm.75 7a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12 12.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0112 12.5z" fill="currentColor"/></svg>
            </button>
            <h1 className="title"><span>Handwriting</span><span>Digitiser</span></h1>
          </div>

          <div style={{display:'flex', alignItems:'center', gap:12}}>
            <div className="dark-toggle">
              <label style={{fontSize:12, color:'var(--muted)'}}>Dark</label>
              <button className="switch" onClick={() => setDark(d=>!d)} aria-pressed={dark} title="Toggle dark">
                <span className="knob" />
              </button>
            </div>
          </div>
        </div>

        {/* About offcanvas */}
        <div className={`offcanvas ${showAbout ? 'show' : ''}`} role="dialog" aria-modal={showAbout}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <h4>About</h4>
            <button className="icon-btn" onClick={() => setShowAbout(false)} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
          <p style={{color:'var(--muted)'}}>This page lets you submit images or documents to the OCR service and download the converted markdown, PDF or Office formats. Use the Capture button to snap a photo on mobile. Dark mode preserves readability and adds a starfield background.</p>
          <hr />
          <p style={{fontSize:13, color:'var(--muted)'}}>Endpoints used: /ocr/jobs, /ocr/fetch, /ocr/convert, /ocr/pandoc.</p>
        </div>

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
              <div className="tab-inner">
                {activeTab === 'input' && (
                  <div className="centered-col">
                    <div style={{width:'100%'}}>
                      <label className="form-label">Select File
                        <svg className="upload-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </label>

                      <div style={{display:'flex', gap:12, alignItems:'center'}}>
                        <input className="form-control" type="file" onChange={(e)=> setFile(e.target.files[0])} />

                        <input ref={cameraInputRef} style={{display:'none'}} accept="image/*" capture="environment" id="cameraInput" type="file" onChange={(e)=> setFile(e.target.files[0])} />
                        <button className="camera-btn" onClick={()=> cameraInputRef.current && cameraInputRef.current.click()} aria-label="Capture from camera">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 17a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M20 7h-3.2l-1.4-1.8A2 2 0 0013.8 4H10.2a2 2 0 00-1.6.8L7.2 7H4a2 2 0 00-2 2v8a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          Capture
                        </button>

                        {previewUrl ? (
                          <img src={previewUrl} alt="preview" className="thumb" />
                        ) : file ? (
                          <div className="file-chip">{file.name}</div>
                        ) : null}
                      </div>

                    </div>

                    <div style={{height:12}} />

                    <div style={{width:'100%', display:'flex', gap:8, alignItems:'center'}}>
                      <div style={{flex:1}}>
                        <label className="form-label">Model</label>
                        <div style={{display:'flex', gap:8, alignItems:'center'}}>
                          <select className="form-control" value={model} onChange={(e)=> setModel(e.target.value)} style={{flex:1}}>
                            {models.map(m=> <option key={m} value={m}>{m}</option>)}
                          </select>
                          <button className="icon-btn" title="Model settings" aria-label="Model settings">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2h0a2 2 0 01-2-2v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06A2 2 0 014.3 16.9l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2v0a2 2 0 012-2h.09c.66 0 1.24-.4 1.51-1A1.65 1.65 0 006.2 6.6l-.06-.06A2 2 0 018.97 3.7l.06.06c.5.5 1.24.6 1.82.33.66-.3 1.47-.3 2.13 0 .58.27 1.32.17 1.82-.33l.06-.06A2 2 0 0119.7 6.2l-.06.06c-.3.66-.3 1.47 0 2.13.27.58.17 1.32-.33 1.82l-.06.06c-.4.4-.6 1-.6 1.6v.09c0 .66.4 1.24 1 1.51z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div style={{height:12}} />

                    <div style={{width:'100%'}}>
                      <div className="form-check">
                        <input className="form-check-input" id="orient" type="checkbox" checked={useDocOrientationClassify} onChange={(e)=> setUseDocOrientationClassify(e.target.checked)} />
                        <label className="form-check-label muted" htmlFor="orient">useDocOrientationClassify</label>
                      </div>
                      <div className="form-check">
                        <input className="form-check-input" id="unwarp" type="checkbox" checked={useDocUnwarping} onChange={(e)=> setUseDocUnwarping(e.target.checked)} />
                        <label className="form-check-label muted" htmlFor="unwarp">useDocUnwarping</label>
                      </div>
                      <div className="form-check">
                        <input className="form-check-input" id="chart" type="checkbox" checked={useChartRecognition} onChange={(e)=> setUseChartRecognition(e.target.checked)} />
                        <label className="form-check-label muted" htmlFor="chart">useChartRecognition</label>
                      </div>
                    </div>

                    <div style={{height:14}} />

                    <div style={{display:'flex', gap:10, width:'100%'}}>
                      <button className="material-btn" onClick={submitJob} disabled={status === "submitting" || status === "polling"}>
                        {/* spinner or gear */}
                        {(status && (status === 'submitting' || status.startsWith('pending') || status.startsWith('running') || status === 'fetching-result' || status.startsWith('converting'))) ? (
                          <svg className="spinner-wheel spin" viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 20v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M4.93 4.93l1.41 1.41" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M17.66 17.66l1.41 1.41" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 12h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M20 12h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M4.93 19.07l1.41-1.41" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M17.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        ) : null}
                        <span>Submit Job</span>
                      </button>

                      <button className="material-btn outline" onClick={() => { setStatus(null); setFile(null); setResults([]); setJobId(null); setPreviewUrl(null); showUserMessage("Reset complete."); }}>
                        Reset
                      </button>

                      <div style={{flex:1}} />

                      <div style={{textAlign:'right'}}>
                        <div className="status-row">
                          {(status && (status === 'submitting' || status.startsWith('pending') || status.startsWith('running') || status === 'fetching-result' || status.startsWith('converting'))) ? (
                            <div style={{display:'flex',alignItems:'center',gap:8}}>
                              <svg className="spinner-wheel spin" viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 20v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M4.93 4.93l1.41 1.41" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M17.66 17.66l1.41 1.41" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 12h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M20 12h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M4.93 19.07l1.41-1.41" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M17.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                              <div style={{textAlign:'right'}}>
                                <div style={{fontWeight:700, color:'var(--text)'}}>{status}</div>
                                {jobId && <div style={{fontSize:12, color:'var(--muted)'}}>Job: {jobId}</div>}
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div style={{fontWeight:700, color:'var(--muted)'}}>{status ?? 'idle'}</div>
                              {jobId && <div style={{fontSize:12, color:'var(--muted)'}}>Job: {jobId}</div>}
                            </div>
                          )}
                        </div>
                      </div>

                    </div>

                  </div>
                )}

                {activeTab === 'results' && (
                  <div>
                    <div className="mb-3">
                      <h6 style={{ marginBottom: 8, color: 'var(--text)' }}>Current status: <span className="muted">{status ?? 'idle'}</span></h6>
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
                  <div className="centered-col">
                    <div className="download-stack" style={{width:'100%'}}>
                      {results.length === 0 && <div style={{ color: 'var(--muted)' }}>No results to download.</div>}
                      {results.map((r, idx) => (
                        <div key={idx} style={{ width: '100%', display:'flex', flexDirection:'column', alignItems:'center', gap: 12 }}>
                          <div style={{ fontWeight: 700, color: 'var(--text)' }}>{r.markdownFilename}</div>
                          <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'center' }}>
                            <button className="material-btn outline" onClick={(e) => handleConvert(r, 'html', e)}>HTML</button>
                            <button className="material-btn outline" onClick={(e) => handleConvert(r, 'docx', e)}>DOCX</button>
                            <button className="material-btn outline" onClick={(e) => handleConvert(r, 'pdf', e)}>PDF</button>
                            {isTopLevelTable(r.markdownHtml) && (<button className="material-btn outline" onClick={(e) => handleConvert(r, 'xlsx', e)}>XLSX</button>)}
                            <button className="material-btn" onClick={() => handleDownloadMarkdown(r)}>Markdown</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>

          </div>
        </div>

        {/* fireworks overlay */}
        {showFireworks && (
          <div className="fireworks-wrap">
            {Array.from({length:12}).map((_,i)=>{
              const left = Math.random()*100; const top = Math.random()*60 + 10; const clr = ['#f97316','#fb7185','#60a5fa','#34d399','#f43f5e','#e879f9'][Math.floor(Math.random()*6)]; const delay = Math.random()*0.8; const duration = 1 + Math.random()*1.2; const style = { left:`${left}%`, top:`${top}%`, background:clr, animation:`fw ${duration}s ${delay}s ease-out forwards` };
              return <span key={i} className="firework" style={style} />;
            })}
            <style>{`@keyframes fw{ 0%{ opacity:1; transform:scale(0);} 60%{ opacity:1; transform:scale(1.6);} 100%{ opacity:0; transform:scale(2.6) translateY(-60px);} }`}</style>
          </div>
        )}

      </div>
    </div>
  );
}

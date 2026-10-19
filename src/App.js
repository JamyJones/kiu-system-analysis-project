import React, { useState, useRef, useEffect } from "react";
import "bootstrap/dist/css/bootstrap.min.css";

// Replace this with your proxy URL (no trailing slash)
const ROUTE_BASE = "/ocr";
const JOB_URL = `${ROUTE_BASE}/jobs`;
const FETCH_ENDPOINT = `${ROUTE_BASE}/fetch?url=`;

async function renderMdPandoc(md){
  try{
    const resp = await fetch(`${ROUTE_BASE}/pandoc`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mdText: md })
    });
    if(!resp.ok){ const t = await resp.text(); throw new Error(`Pandoc failed: ${resp.status} ${t}`); }
    const j = await resp.json(); return j?.html ?? '';
  }catch(e){ return `<pre style="color:red">Error rendering markdown: ${String(e.message)}</pre>`; }
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export default function App(){
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [model, setModel] = useState('PaddleOCR-VL-1.6');
  const [useDocOrientationClassify, setUseDocOrientationClassify] = useState(false);
  const [useDocUnwarping, setUseDocUnwarping] = useState(false);
  const [useChartRecognition, setUseChartRecognition] = useState(false);

  const [status, setStatus] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [results, setResults] = useState([]);
  const [activeTab, setActiveTab] = useState('input');
  const [dark, setDark] = useState(()=>{ try{return localStorage.getItem('ui-dark')==='1'}catch{return false} });
  const [showFireworks, setShowFireworks] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  const pollingRef = useRef(null);
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(()=>{ try{ localStorage.setItem('ui-dark', dark ? '1' : '0'); }catch{} }, [dark]);

  useEffect(()=>{ if(showFireworks){ const t = setTimeout(()=>setShowFireworks(false), 3800); return ()=>clearTimeout(t);} }, [showFireworks]);

  useEffect(()=>{
    if(file){
      try{ if(previewUrl) URL.revokeObjectURL(previewUrl); }catch{}
      if(file.type && file.type.startsWith('image/')){ setPreviewUrl(URL.createObjectURL(file)); } else setPreviewUrl(null);
    } else { if(previewUrl){ URL.revokeObjectURL(previewUrl); setPreviewUrl(null); } }
  }, [file]);

  function log(msg){ console.log(`${new Date().toLocaleTimeString()} - ${msg}`); }
  function showUserMessage(m){ window.alert(m); }

  async function submitJob(){
    setStatus('submitting'); setResults([]); setJobId(null);
    if(!file){ showUserMessage('Please select a file first'); setStatus(null); return; }
    try{
      const optionalPayload = { useDocOrientationClassify, useDocUnwarping, useChartRecognition };
      const form = new FormData(); form.append('file', file); form.append('model', model); form.append('optionalPayload', JSON.stringify(optionalPayload));
      const resp = await fetch(JOB_URL, { method: 'POST', body: form });
      if(!resp.ok){ const t = await resp.text(); log(`Submit failed: ${resp.status} ${t}`); showUserMessage(`Submit failed: ${resp.status}`); setStatus(null); return; }
      const j = await resp.json(); const jid = j?.data?.jobId; if(!jid){ showUserMessage('Server did not return job id'); setStatus(null); return; }
      setJobId(jid); setStatus('polling'); setActiveTab('results'); pollJob(jid);
    }catch(e){ log('Submit error: '+e.message); showUserMessage('Submit error'); setStatus(null); }
  }

  async function pollJob(jid){
    if(pollingRef.current) { clearTimeout(pollingRef.current); pollingRef.current = null; }
    const pollOnce = async ()=>{
      try{
        const resp = await fetch(`${JOB_URL}/${jid}`); if(!resp.ok){ showUserMessage(`Status fetch failed: ${resp.status}`); setStatus(null); return; }
        const j = await resp.json(); const state = j?.data?.state; if(!state){ showUserMessage('Unexpected job payload'); setStatus(null); return; }
        if(state === 'pending'){ setStatus('pending: queued'); pollingRef.current = setTimeout(pollOnce, 2000); }
        else if(state === 'running'){ const prog = j?.data?.extractProgress||{}; setStatus(`running: extracted ${prog.extractedPages??'?'} / ${prog.totalPages??'?'} `); pollingRef.current = setTimeout(pollOnce, 2000); }
        else if(state === 'done'){ const jsonl = j?.data?.resultUrl?.jsonUrl; if(jsonl){ setStatus('fetching-result'); await fetchJsonlAndProcess(jsonl); setStatus('done'); setShowFireworks(true); showUserMessage('Results ready'); setActiveTab('results'); } else { showUserMessage('Job done but no results'); setStatus(null); } }
        else if(state === 'failed'){ setStatus('failed'); showUserMessage(`Job failed: ${j?.data?.errorMsg||'unknown'}`); }
        else setStatus(null);
      }catch(e){ log('Poll error: '+e.message); showUserMessage('Error polling job'); setStatus(null); }
    };
    pollOnce();
  }

  async function fetchJsonlAndProcess(jsonlUrl){
    try{
      const proxy = `${FETCH_ENDPOINT}${encodeURIComponent(jsonlUrl)}`; const resp = await fetch(proxy); if(!resp.ok){ showUserMessage('Failed to download results'); return; }
      const text = await resp.text(); const lines = text.trim().split('\n').filter(Boolean);
      const out = []; let p=0;
      for(const L of lines){ const parsed = JSON.parse(L); const result = parsed.result; if(!result) continue; const layout = result.layoutParsingResults||[]; for(const r of layout){ const md = r?.markdown?.text || ''; out.push({ markdownText: md, markdownFilename: `doc_${p}.md`, markdownHtml: null }); p++; } }
      setResults(out);
      out.forEach((it, idx)=> renderMdPandoc(it.markdownText).then(html=> setResults(prev=>{ const c = prev.slice(); if(!c[idx]) return prev; c[idx] = { ...c[idx], markdownHtml: html }; return c; })) );
    }catch(e){ log('Fetch/process error: '+e.message); showUserMessage('Error processing results'); }
  }

  function handleDownloadMarkdown(item){ const blob = new Blob([item.markdownText], { type:'text/markdown;charset=utf-8' }); downloadBlob(blob, item.markdownFilename); }

  function isTopLevelTable(html){ if(!html) return false; return (/^\s*<table\b/i).test(html.trim()); }

  async function handleConvert(item, format){ try{ setStatus(`converting: ${format}`); const body = { mdText: item.markdownText, format }; const resp = await fetch(`${ROUTE_BASE}/convert`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)}); if(!resp.ok){ showUserMessage('Conversion failed'); setStatus(null); return; } const blob = await resp.blob(); const ext = format; const filename = item.markdownFilename.replace(/\.md$/, `.${ext}`); downloadBlob(blob, filename); setStatus('done'); }catch(e){ log('Convert error: '+e.message); showUserMessage('Conversion error'); setStatus(null); } }

  const models = ['PaddleOCR-VL-1.6','PaddleOCR-Card-1.0','PaddleOCR-Table-1.2'];

  function addRipple(e){
    const btn = e.currentTarget; if(!btn) return; const rect = btn.getBoundingClientRect(); const ripple = document.createElement('span'); ripple.className = 'ripple'; const size = Math.max(rect.width, rect.height) * 1.2; ripple.style.width = ripple.style.height = size + 'px'; ripple.style.left = (e.clientX - rect.left - size/2) + 'px'; ripple.style.top = (e.clientY - rect.top - size/2) + 'px'; btn.appendChild(ripple); setTimeout(()=> ripple.remove(), 600);
  }

  return (
    <div className={dark ? 'app-root dark' : 'app-root'}>

      <style>{`
:root{ --bg1:#f7fbff; --bg2:#e6f0ff; --card:#ffffff; --text:#0f172a; --muted:#475569; --accent:#2563eb; --accent-2:#06b6d4; --tab-bg:#f1f5f9; --tab-active:linear-gradient(90deg,#60a5fa,#7dd3fc); --submit-grad: linear-gradient(90deg,var(--accent),var(--accent-2)); }
.dark{ --bg1:#071024; --bg2:#0b1220; --card:rgba(255,255,255,0.03); --text:#e6eef8; --muted:#94a3b8; --accent:#60a5fa; --accent-2:#7c3aed; --tab-bg:rgba(255,255,255,0.02); --tab-active:linear-gradient(90deg,#0ea5e9,#7c3aed); --submit-grad: linear-gradient(90deg,#0ea5e9,#7c3aed); }

.app-root{ min-height:100vh; color:var(--text); font-family:Inter, system-ui, Roboto, 'Helvetica Neue', Arial; padding:14px; overflow-x:hidden; }
.bg-animated{ position:fixed; inset:0; z-index:-3; background: linear-gradient(120deg,var(--bg1),var(--bg2)); background-size:400% 400%; animation: gradientAnim 18s ease infinite; }
.dark .bg-animated{ background: linear-gradient(120deg,var(--bg1),var(--bg2)); animation: none; }
@keyframes gradientAnim{ 0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%} }

.container-mobile{ max-width:940px; margin:0 auto; position:relative; z-index:1; }

h1.title{ text-align:center; font-family: 'Segoe Script', 'Bradley Hand', cursive, serif; font-size:3rem; line-height:0.95; margin:8px 0 16px; font-weight:900; }
h1.title span{ display:block }

.topbar{ display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px; }
.top-left{ display:flex; align-items:center; gap:12px; }
.icon-btn{ background:transparent; border:0; color:var(--text); padding:8px; border-radius:10px; cursor:pointer; position:relative; overflow:hidden; }
.icon-btn:active{ transform:translateY(1px); }

/* ripple */
.ripple{ position:absolute; border-radius:50%; transform:scale(0); opacity:0.7; pointer-events:none; animation: rippleAnim .6s ease-out; mix-blend-mode:overlay; }
@keyframes rippleAnim{ to{ transform:scale(1); opacity:0; } }

/* glass */
.glass-panel{ background: linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0.46)); border-radius:16px; border:1px solid rgba(255,255,255,0.6); box-shadow: 0 10px 30px rgba(16,24,40,0.08); backdrop-filter: blur(10px) saturate(140%); }
.dark .glass-panel{ background: linear-gradient(180deg, rgba(10,20,30,0.6), rgba(8,12,20,0.46)); border:1px solid rgba(255,255,255,0.04); box-shadow: 0 14px 40px rgba(2,6,23,0.6); }

/* backdrop blur for offcanvas */
.backdrop-blur{ position:fixed; inset:0; z-index:1600; background: rgba(2,6,23,0.35); backdrop-filter: blur(6px); }
.offcanvas{ position:fixed; left:0; top:0; width:320px; max-width:92%; height:100%; background: var(--card); color:var(--text); box-shadow: 0 12px 40px rgba(2,6,23,0.12); transform:translateX(-112%); transition:transform .28s ease; z-index:1700; padding:18px; border-radius:0 12px 12px 0; }
.offcanvas.show{ transform:translateX(0%); }

.nav-tabs{ display:flex; gap:10px; padding:8px; background:transparent; border-bottom:none; }
.nav-tabs .nav-item{ flex:1 }
.nav-tabs .nav-link{ display:flex; align-items:center; justify-content:center; padding:12px 8px; border-radius:12px; background:var(--tab-bg); color:var(--text); font-weight:800; border:none }
.nav-tabs .nav-link.active{ background: var(--tab-active); color:#04263a; box-shadow: 0 10px 28px rgba(2,6,23,0.08); }

.tab-panel{ padding:12px; display:flex; justify-content:center }
.tab-inner{ width:100%; max-width:680px }

label.form-label{ display:flex; align-items:center; gap:10px; font-weight:800; color:var(--text); }
.upload-icon{ width:18px; height:18px }
.centered-col{ display:flex; flex-direction:column; align-items:center }
.form-control[readonly]{ background:transparent; border:1px dashed rgba(0,0,0,0.06); color:var(--text) }

.material-btn{ display:inline-flex; align-items:center; justify-content:center; gap:10px; padding:12px 18px; border-radius:12px; border:none; cursor:pointer; color:white; background:var(--submit-grad); font-weight:800; position:relative; overflow:hidden }
.material-btn.outline{ background:transparent; color:var(--text); border:1px solid rgba(15,23,42,0.06); box-shadow:none }
.material-btn:active{ transform:translateY(2px) scale(.995) }

.camera-btn{ display:inline-flex; align-items:center; gap:8px; padding:10px 12px; border-radius:10px; background:rgba(2,6,23,0.06); border:none; color:var(--text); position:relative; overflow:hidden }

.status-row{ display:flex; align-items:center; gap:12px }
.muted{ color:var(--muted) }

.spinner-wheel{ width:26px; height:26px; display:inline-block }
.spin{ animation: spin 1s linear infinite }
@keyframes spin{ to{ transform:rotate(360deg) } }

.download-stack{ display:flex; flex-direction:column; gap:10px; align-items:center }
.thumb{ width:84px; height:84px; object-fit:cover; border-radius:10px; border:1px solid rgba(0,0,0,0.06) }
.file-chip{ display:inline-flex; gap:8px; align-items:center; padding:8px 10px; border-radius:999px; background:rgba(15,23,42,0.04); color:var(--text) }

.fireworks-wrap{ pointer-events:none; position:fixed; left:0; top:0; width:100%; height:100%; z-index:9999; overflow:hidden }
.firework{ position:absolute; width:12px; height:12px; border-radius:50%; opacity:0; transform:scale(0) }

.stars-wrap{ pointer-events:none; position:fixed; left:0; top:0; width:100%; height:100%; z-index:-1; overflow:hidden }
.star{ position:absolute; width:3px; height:3px; border-radius:50%; background:white; opacity:0.9; animation: twinkle 3s infinite }
@keyframes twinkle{ 0%{opacity:0.2}50%{opacity:1}100%{opacity:0.2} }

.upload-native{ display:inline-flex; align-items:center; gap:10px; padding:12px 14px; border-radius:12px; background:rgba(255,255,255,0.9); box-shadow: 0 6px 14px rgba(2,6,23,0.06); color:var(--text); cursor:pointer; border:1px solid rgba(0,0,0,0.06) }
.dark .upload-native{ background: rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.04) }

.dark .ripple{ background: rgba(0,0,0,0.25) }

@media (max-width:640px){ h1.title{ font-size:2.1rem } .nav-tabs .nav-link{ padding:10px 6px; font-size:14px } }
      `}</style>

      <div className="bg-animated" />

      {dark && (
        <div className="stars-wrap" aria-hidden>
          {Array.from({length:40}).map((_,i)=>{ const left = Math.random()*100; const top = Math.random()*100; const delay = Math.random()*4; const dur = 2+Math.random()*3; const style = { left:`${left}%`, top:`${top}%`, animationDelay:`${delay}s`, animationDuration:`${dur}s`, opacity:Math.random()*.9+.1 }; return <span key={i} className="star" style={style} /> })}
        </div>
      )}

      <div className="container-mobile">
        <div className="topbar">
          <div className="top-left">
            <button className="icon-btn" aria-label="About" onClick={()=>setShowAbout(true)} onMouseDown={addRipple}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm.75 7a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12 12.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0112 12.5z" fill="currentColor"/></svg>
            </button>
            <h1 className="title"><span>Handwriting</span><span>Digitiser</span></h1>
          </div>

          <div style={{display:'flex', alignItems:'center', gap:12}}>
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              <label style={{fontSize:12, color:'var(--muted)'}}>Dark</label>
              <button className="icon-btn switch" onClick={()=>setDark(d=>!d)} aria-pressed={dark} onMouseDown={addRipple}>
                <span className="knob" style={{display:'inline-block', width:18, height:18, borderRadius:999, background:'#fff'}} />
              </button>
            </div>
          </div>
        </div>

        {showAbout && <div className="backdrop-blur" onClick={()=>setShowAbout(false)} />}
        <div className={`offcanvas ${showAbout ? 'show' : ''}`} role="dialog" aria-modal={showAbout}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <h4>About</h4>
            <button className="icon-btn" onClick={()=>setShowAbout(false)} onMouseDown={addRipple}><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
          </div>
          <p style={{color:'var(--muted)'}}>This UI submits images or documents to an OCR backend. Capture from camera on mobile, or upload files. After processing you can download results as Markdown, PDF or Office formats.</p>
          <hr />
          <p style={{fontSize:13, color:'var(--muted)'}}>Endpoints: /ocr/jobs, /ocr/fetch, /ocr/convert, /ocr/pandoc</p>
        </div>

        <div className="card mb-3 glass-panel">
          <div className="card-body">

            <ul className="nav nav-tabs mb-3" role="tablist">
              <li className="nav-item"><button className={`nav-link ${activeTab==='input'?'active':''}`} onClick={()=>setActiveTab('input')} onMouseDown={addRipple}>Input</button></li>
              <li className="nav-item"><button className={`nav-link ${activeTab==='results'?'active':''}`} onClick={()=>setActiveTab('results')} onMouseDown={addRipple}>Results</button></li>
              <li className="nav-item"><button className={`nav-link ${activeTab==='downloads'?'active':''}`} onClick={()=>setActiveTab('downloads')} onMouseDown={addRipple}>Downloads</button></li>
            </ul>

            <div className="tab-panel">
              <div className="tab-inner">

                {activeTab === 'input' && (
                  <div className="centered-col">
                    <div style={{width:'100%'}}>
                      <label className="form-label">Select File
                        <svg className="upload-icon" viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M12 3v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </label>

                      <div style={{display:'flex', gap:12, alignItems:'center', flexWrap:'wrap'}}>
                        <input id="fileInput" ref={fileInputRef} type="file" className="d-none" onChange={(e)=> setFile(e.target.files[0])} />
                        <label htmlFor="fileInput" className="upload-native" onMouseDown={addRipple}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          <span style={{fontWeight:800}}>Upload</span>
                        </label>

                        <input ref={cameraInputRef} style={{display:'none'}} accept="image/*" capture="environment" id="cameraInput" type="file" onChange={(e)=> setFile(e.target.files[0])} />
                        <button className="camera-btn" onClick={()=> cameraInputRef.current && cameraInputRef.current.click()} onMouseDown={addRipple}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 17a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M20 7h-3.2l-1.4-1.8A2 2 0 0013.8 4H10.2a2 2 0 00-1.6.8L7.2 7H4a2 2 0 00-2 2v8a2 2 0 002 2h16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          Capture
                        </button>

                        {previewUrl ? <img src={previewUrl} alt="preview" className="thumb" /> : file ? <div className="file-chip">{file.name}</div> : null}
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
                          <button className="icon-btn" title="Model settings" onMouseDown={addRipple}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div style={{height:12}} />

                    <div style={{width:'100%'}}>
                      <div className="form-check"><input className="form-check-input" id="orient" type="checkbox" checked={useDocOrientationClassify} onChange={(e)=> setUseDocOrientationClassify(e.target.checked)} /> <label className="form-check-label muted" htmlFor="orient">useDocOrientationClassify</label></div>
                      <div className="form-check"><input className="form-check-input" id="unwarp" type="checkbox" checked={useDocUnwarping} onChange={(e)=> setUseDocUnwarping(e.target.checked)} /> <label className="form-check-label muted" htmlFor="unwarp">useDocUnwarping</label></div>
                      <div className="form-check"><input className="form-check-input" id="chart" type="checkbox" checked={useChartRecognition} onChange={(e)=> setUseChartRecognition(e.target.checked)} /> <label className="form-check-label muted" htmlFor="chart">useChartRecognition</label></div>
                    </div>

                    <div style={{height:14}} />

                    <div style={{display:'flex', gap:10, width:'100%'}}>
                      <button className="material-btn" onClick={submitJob} disabled={status==='submitting' || status==='polling'} onMouseDown={addRipple}>
                        {(status && (status==='submitting' || status.startsWith('pending') || status.startsWith('running') || status==='fetching-result' || status.startsWith('converting'))) ? <svg className="spinner-wheel spin" viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M12 2v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg> : null}
                        <span>Submit Job</span>
                      </button>

                      <button className="material-btn outline" onClick={()=>{ setStatus(null); setFile(null); setResults([]); setJobId(null); setPreviewUrl(null); showUserMessage('Reset complete'); }} onMouseDown={addRipple}>Reset</button>

                      <div style={{flex:1}} />

                      <div style={{textAlign:'right'}}>
                        <div className="status-row">
                          {(status && (status==='submitting' || status.startsWith('pending') || status.startsWith('running') || status==='fetching-result' || status.startsWith('converting'))) ? (
                            <div style={{display:'flex',alignItems:'center',gap:8}}>
                              <svg className="spinner-wheel spin" viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="M12 2v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                              <div style={{textAlign:'right'}}><div style={{fontWeight:800, color:'var(--text)'}}>{status}</div>{jobId && <div style={{fontSize:12, color:'var(--muted)'}}>Job: {jobId}</div>}</div>
                            </div>
                          ) : (
                            <div><div style={{fontWeight:800, color:'var(--muted)'}}>{status ?? 'idle'}</div>{jobId && <div style={{fontSize:12, color:'var(--muted)'}}>Job: {jobId}</div>}</div>
                          )}
                        </div>
                      </div>
                    </div>

                  </div>
                )}

                {activeTab === 'results' && (
                  <div>
                    <div style={{marginBottom:8}}><h6 style={{marginBottom:6, color:'var(--text)'}}>Current status: <span style={{color:'var(--muted)'}}>{status ?? 'idle'}</span></h6>{jobId && <div style={{color:'var(--muted)'}}><strong>JobId:</strong> {jobId}</div>}</div>
                    <div className="card result-card"><div className="card-body">{results.length===0 ? <div style={{color:'var(--muted)'}}>No results yet.</div> : results.map((r,i)=>(<div key={i} className="mb-3"><strong style={{color:'var(--text)'}}>{r.markdownFilename}</strong><div style={{whiteSpace:'pre-wrap', padding:8, marginTop:6, color:'var(--text)'}} dangerouslySetInnerHTML={{__html: r.markdownHtml ?? '<em>Rendering...</em>'}} /></div>))}</div></div>
                  </div>
                )}

                {activeTab === 'downloads' && (
                  <div className="centered-col"><div className="download-stack" style={{width:'100%'}}>{results.length===0 ? <div style={{color:'var(--muted)'}}>No results to download.</div> : results.map((r,idx)=>(<div key={idx} style={{width:'100%', display:'flex', flexDirection:'column', alignItems:'center', gap:12}}><div style={{fontWeight:800, color:'var(--text)'}}>{r.markdownFilename}</div><div style={{display:'flex', gap:8, flexWrap:'wrap', justifyContent:'center'}}><button className="material-btn outline" onClick={()=>handleConvert(r,'html')} onMouseDown={addRipple}>HTML</button><button className="material-btn outline" onClick={()=>handleConvert(r,'docx')} onMouseDown={addRipple}>DOCX</button><button className="material-btn outline" onClick={()=>handleConvert(r,'pdf')} onMouseDown={addRipple}>PDF</button>{isTopLevelTable(r.markdownHtml) && <button className="material-btn outline" onClick={()=>handleConvert(r,'xlsx')} onMouseDown={addRipple}>XLSX</button>}<button className="material-btn" onClick={()=>handleDownloadMarkdown(r)} onMouseDown={addRipple}>Markdown</button></div></div>))}</div></div>
                )}

              </div>
            </div>

          </div>
        </div>

        {showFireworks && (
          <div className="fireworks-wrap">{Array.from({length:12}).map((_,i)=>{ const left = Math.random()*100; const top = Math.random()*60+10; const clr = ['#f97316','#fb7185','#60a5fa','#34d399','#f43f5e','#e879f9'][Math.floor(Math.random()*6)]; const delay = Math.random()*0.8; const duration = 1+Math.random()*1.2; const style = { left:`${left}%`, top:`${top}%`, background:clr, animation:`fw ${duration}s ${delay}s ease-out forwards` }; return <span key={i} className="firework" style={style} /> })}<style>{`@keyframes fw{ 0%{ opacity:1; transform:scale(0);} 60%{ opacity:1; transform:scale(1.6);} 100%{ opacity:0; transform:scale(2.6) translateY(-60px);} }`}</style></div>
        )}

      </div>
    </div>
  );
}

import React from 'react';

export default function AppUI({ logic }){
  const {
    file, setFile, previewUrl,
    model, setModel, models,
    useDocOrientationClassify, setUseDocOrientationClassify,
    useDocUnwarping, setUseDocUnwarping,
    useChartRecognition, setUseChartRecognition,
    status, jobId, results, activeTab, setActiveTab,
    dark, setDark, showFireworks, showAbout, setShowAbout,
    pollingRef, cameraInputRef, fileInputRef,
    submitJob, handleDownloadMarkdown, handleConvert, isTopLevelTable,
  } = logic;

  function addRipple(e){
    const btn = e.currentTarget; if(!btn) return; const rect = btn.getBoundingClientRect(); const ripple = document.createElement('span'); ripple.className = 'ripple'; const size = Math.max(rect.width, rect.height)*1.2; ripple.style.width = ripple.style.height = `${size}px`; ripple.style.left = `${e.clientX - rect.left - size/2}px`; ripple.style.top = `${e.clientY - rect.top - size/2}px`; btn.appendChild(ripple); setTimeout(()=> ripple.remove(), 650);
  }

  return (
    <div className={dark ? 'app-root dark' : 'app-root'}>

      <style>{`...`}</style>

      <div className="bg-animated" />

      {dark && (
        <div className="stars-wrap" aria-hidden>
          {Array.from({length:12}).map((_,i)=> <span key={i} className="star" style={{left:`${Math.random()*100}%`, top:`${Math.random()*100}%`}} />)}
        </div>
      )}

      <div className="container-mobile">
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:8}}>
          <div style={{display:'flex', alignItems:'center', gap:12}}>
            <button className="icon-btn" aria-label="About" onClick={()=>setShowAbout(true)} onMouseDown={addRipple}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm.75 7a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12 17.5a.75.75 0 110-1.5.75.75 0 010 1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
        <div className={`offcanvas ${showAbout ? 'show' : ''}`} role="dialog" aria-modal={showAbout} style={{position:'relative', padding:12}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <h4>About</h4>
            <button className="icon-btn" onClick={()=>setShowAbout(false)} onMouseDown={addRipple}><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
          </div>
          <p style={{color:'var(--muted)'}}>This UI submits images or documents to an OCR backend. Capture from camera on mobile, or upload files. After processing you can download results as Markdown or convert to other formats.</p>
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

            <div style={{padding:12, display:'flex', justifyContent:'center'}}>
              <div style={{width:'100%', maxWidth:680}}>

                {activeTab === 'input' && (
                  <div className="centered-col">
                    <div style={{width:'100%'}}>
                      <label className="form-label">Select File</label>

                      <div style={{display:'flex', gap:12, alignItems:'center', flexWrap:'wrap'}}>
                        <input id="fileInput" ref={fileInputRef} type="file" className="d-none" onChange={(e)=> setFile && setFile(e.target.files[0])} />
                        <label htmlFor="fileInput" className="upload-native" onMouseDown={addRipple} style={{cursor:'pointer', display:'inline-flex', alignItems:'center', gap:10, padding:12, borderRadius:12, background:'rgba(255,255,255,0.9)'}}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 12l7-7 7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          <span style={{fontWeight:800}}>Upload</span>
                        </label>

                        <input ref={cameraInputRef} style={{display:'none'}} accept="image/*" capture="environment" id="cameraInput" type="file" onChange={(e)=> setFile && setFile(e.target.files[0])} />
                        <button className="camera-btn" onClick={()=> cameraInputRef.current && cameraInputRef.current.click()} onMouseDown={addRipple} style={{display:'inline-flex', alignItems:'center', gap:8, padding:10, borderRadius:10}}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 17a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
                          <select className="form-control" value={model} onChange={(e)=> setModel && setModel(e.target.value)} style={{flex:1}}>
                            {models.map(m=> <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>

                    <div style={{height:12}} />

                    <div style={{width:'100%'}}>
                      <div className="form-check"><input className="form-check-input" id="orient" type="checkbox" checked={useDocOrientationClassify} onChange={(e)=> setUseDocOrientationClassify && setUseDocOrientationClassify(e.target.checked)} /> <label htmlFor="orient">Use document orientation classify</label></div>
                      <div className="form-check"><input className="form-check-input" id="unwarp" type="checkbox" checked={useDocUnwarping} onChange={(e)=> setUseDocUnwarping && setUseDocUnwarping(e.target.checked)} /> <label htmlFor="unwarp">Use document unwarping</label></div>
                      <div className="form-check"><input className="form-check-input" id="chart" type="checkbox" checked={useChartRecognition} onChange={(e)=> setUseChartRecognition && setUseChartRecognition(e.target.checked)} /> <label htmlFor="chart">Use chart recognition</label></div>
                    </div>

                    <div style={{height:14}} />

                    <div style={{display:'flex', gap:10, width:'100%'}}>
                      <button className="material-btn" onClick={submitJob} disabled={status==='submitting' || status==='polling'} onMouseDown={addRipple} style={{padding:12, borderRadius:12, background:'linear-gradient(90deg,#60a5fa,#7dd3fc)', color:'#04263a'}}>
                        <span>Submit Job</span>
                      </button>

                      <button className="material-btn outline" onClick={()=>{ /* reset */ if(setFile) setFile(null); if(setStatus) setStatus(null); if(setModel) setModel('PaddleOCR-VL-1.6'); if(setUseDocOrientationClassify) setUseDocOrientationClassify(false); if(setUseDocUnwarping) setUseDocUnwarping(false); if(setUseChartRecognition) setUseChartRecognition(false); }} onMouseDown={addRipple} style={{padding:12, borderRadius:12}}>
                        Reset
                      </button>

                      <div style={{flex:1}} />

                      <div style={{textAlign:'right'}}>
                        <div className="status-row">
                          <div><div style={{fontWeight:800, color:'var(--muted)'}}>{status ?? 'idle'}</div>{jobId && <div style={{fontSize:12, color:'var(--muted)'}}>Job: {jobId}</div>}</div>
                        </div>
                      </div>
                    </div>

                  </div>
                )}

                {activeTab === 'results' && (
                  <div>
                    <div style={{marginBottom:8}}><h6 style={{marginBottom:6, color:'var(--text)'}}>Current status: <span style={{color:'var(--muted)'}}>{status ?? 'idle'}</span></h6>{jobId && <div style={{fontSize:12, color:'var(--muted)'}}>Job ID: {jobId}</div>}</div>
                    <div className="card result-card"><div className="card-body">{results.length===0 ? <div style={{color:'var(--muted)'}}>No results yet.</div> : results.map((r,i)=>(<div key={i} style={{marginBottom:14, borderBottom:'1px dashed rgba(0,0,0,0.06)', paddingBottom:10}}><div style={{display:'flex', justifyContent:'space-between'}}><strong>Result {i+1}</strong><div><button onClick={()=> handleDownloadMarkdown(r)} onMouseDown={addRipple} className="material-btn" style={{padding:'6px 10px'}}>Download MD</button>{' '}{/* convert buttons */}<button onClick={()=> handleConvert(r,'pdf')} onMouseDown={addRipple} style={{marginLeft:8,padding:'6px 10px'}}>PDF</button></div></div><pre style={{whiteSpace:'pre-wrap', marginTop:8}}>{r.markdownText}</pre></div>))}</div></div>
                  </div>
                )}

                {activeTab === 'downloads' && (
                  <div className="centered-col"><div className="download-stack" style={{width:'100%'}}>{results.length===0 ? <div style={{color:'var(--muted)'}}>No results to download.</div> : results.map((r,i)=> <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:8,border:'1px solid rgba(0,0,0,0.04)',borderRadius:8,marginBottom:8}}><div>{r.markdownFilename}</div><div><button onClick={()=> handleDownloadMarkdown(r)} onMouseDown={addRipple} className="material-btn">Download</button></div></div>)}</div></div>
                )}

              </div>
            </div>

          </div>
        </div>

        {showFireworks && (
          <div className="fireworks-wrap">{Array.from({length:8}).map((_,i)=> <div key={i} className="firework" style={{left:`${Math.random()*100}%`, top:`${Math.random()*60+10}%`, background:['#f97316','#fb7185','#60a5fa','#34d399'][i%4]}}/>)}</div>
        )}

      </div>
    </div>
  );
}

import React, { useState } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faMoon,
  faSun,
  faGear,
  faCircleInfo,
  faUpload,
  faCamera,
  faDownload,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';

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

  const [showModelSettings, setShowModelSettings] = useState(false);

  function addRipple(e){
    const btn = e.currentTarget; if(!btn) return; const rect = btn.getBoundingClientRect(); const ripple = document.createElement('span'); ripple.className = 'ripple'; const size = Math.max(rect.width, rect.height); ripple.style.width = size + 'px'; ripple.style.height = size + 'px'; ripple.style.left = (e.clientX - rect.left - size/2) + 'px'; ripple.style.top = (e.clientY - rect.top - size/2) + 'px'; btn.appendChild(ripple); setTimeout(()=> ripple.remove(), 600);
  }

  return (
    <div className={dark ? 'app-root dark' : 'app-root'}>

      <style>{`
        .app-root {
          min-height: 100vh;
          padding: 16px;
          font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        }
        .container-mobile {
          max-width: 840px;
          margin: 0 auto;
        }
        .topbar {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 12px;
          margin-bottom: 8px;
        }
        .top-left,
        .top-right {
          display: flex;
          align-items: center;
        }
        .top-right {
          justify-content: flex-end;
        }
        .title {
          margin: 0;
          font-size: 20px;
          line-height: 1;
          text-align: center;
          display: flex;
          gap: 6px;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
        }
        .icon-btn {
          position: relative;
          overflow: hidden;
          width: 36px;
          height: 36px;
          border: 0;
          border-radius: 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(255,255,255,0.04);
          color: var(--muted, #6b7280);
          cursor: pointer;
        }
        .icon-btn svg {
          width: 16px;
          height: 16px;
          display: block;
          font-size: 16px;
        }
        .icon-btn:active {
          transform: scale(0.98);
        }
        .ripple {
          position: absolute;
          border-radius: 999px;
          background: rgba(0,0,0,0.12);
          transform: scale(0);
          animation: ripple .6s linear;
          pointer-events: none;
        }
        @keyframes ripple {
          to {
            transform: scale(2.2);
            opacity: 0;
          }
        }
        .backdrop-blur {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.38);
          backdrop-filter: blur(2px);
          z-index: 70;
        }
        .offcanvas {
          position: fixed;
          left: 12px;
          top: 80px;
          width: min(360px, calc(100vw - 24px));
          background: var(--card-bg, #fff);
          box-shadow: 0 14px 36px rgba(0,0,0,0.18);
          border-radius: 12px;
          padding: 12px;
          z-index: 80;
          display: none;
        }
        .offcanvas.show {
          display: block;
        }
        .offcanvas-right {
          position: fixed;
          right: 12px;
          top: 80px;
          width: min(330px, calc(100vw - 24px));
          background: var(--card-bg, #fff);
          box-shadow: 0 14px 36px rgba(0,0,0,0.18);
          border-radius: 12px;
          padding: 12px;
          z-index: 90;
          display: none;
        }
        .offcanvas-right.show {
          display: block;
        }
        .stars-wrap {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 10;
        }
        .star {
          position: absolute;
          width: 4px;
          height: 4px;
          background: rgba(255,255,255,0.9);
          border-radius: 50%;
          box-shadow: 0 0 8px rgba(255,255,255,0.8);
        }
        .thumb {
          max-width: 120px;
          max-height: 80px;
          border-radius: 8px;
        }
        .file-chip {
          padding: 8px 12px;
          border-radius: 8px;
          background: rgba(148, 163, 184, 0.12);
        }
        .material-btn {
          border: 0;
          padding: 10px 14px;
          border-radius: 10px;
          background: #2563eb;
          color: #fff;
          font-weight: 600;
        }
        .material-btn.outline {
          background: transparent;
          border: 1px solid rgba(148, 163, 184, 0.4);
          color: var(--text, #111827);
        }
        .nav-tabs .nav-link {
          cursor: pointer;
        }
      `}</style>

      <div className="bg-animated" />

      {dark && (
        <div className="stars-wrap" aria-hidden>
          {Array.from({length:12}).map((_,i)=> <span key={i} className="star" style={{left:`${Math.random()*100}%`, top:`${Math.random()*100}%`}} />)}
        </div>
      )}

      <div className="container-mobile">
        <div className="topbar">
          <div className="top-left">
            <button className="icon-btn" aria-label="About" onClick={()=>setShowAbout(true)} onMouseDown={addRipple}>
              <FontAwesomeIcon icon={faCircleInfo} />
            </button>
          </div>

          <div className="title-wrap">
            <h1 className="title"><span>Handwriting</span><span>Digitiser</span></h1>
          </div>

          <div className="top-right">
            <button className="icon-btn" onClick={()=>setDark(d=>!d)} aria-pressed={dark} onMouseDown={addRipple} aria-label="Toggle theme">
              <FontAwesomeIcon icon={dark ? faMoon : faSun} />
            </button>
          </div>
        </div>

        {showAbout && <div className="backdrop-blur" onClick={()=>setShowAbout(false)} />}
        <div className={`offcanvas ${showAbout ? 'show' : ''}`} role="dialog" aria-modal={showAbout} style={{position:'relative', padding:12}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <h4>About</h4>
            <button className="icon-btn" onClick={()=>setShowAbout(false)} onMouseDown={addRipple}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
          <p style={{color:'var(--muted)'}}>This UI submits images or documents to an OCR backend. Capture from camera on mobile, or upload files. After processing you can download results as Markdown.</p>
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
                        <label htmlFor="fileInput" className="upload-native" onMouseDown={addRipple} style={{cursor:'pointer', display:'inline-flex', alignItems:'center', gap:10, padding:12, borderRadius:8, border:'1px dashed rgba(0,0,0,.08)'}}>
                          <FontAwesomeIcon icon={faUpload} />
                          <span style={{fontWeight:800}}>Upload</span>
                        </label>

                        <input ref={cameraInputRef} style={{display:'none'}} accept="image/*" capture="environment" id="cameraInput" type="file" onChange={(e)=> setFile && setFile(e.target.files[0])} />
                        <button className="camera-btn icon-btn" onClick={()=> cameraInputRef.current && cameraInputRef.current.click()} onMouseDown={addRipple} style={{display:'inline-flex', alignItems:'center', gap:8}}>
                          <FontAwesomeIcon icon={faCamera} />
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
                          <button className="icon-btn" title="Model settings" onClick={()=> setShowModelSettings(s=>!s)} onMouseDown={addRipple}>
                            <FontAwesomeIcon icon={faGear} />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div style={{height:14}} />

                    <div style={{display:'flex', gap:10, width:'100%'}}>
                      <button className="material-btn" onClick={submitJob} disabled={status==='submitting' || status==='polling'} onMouseDown={addRipple} style={{padding:12, borderRadius:12}}>
                        <span>Submit Job</span>
                      </button>

                      <button className="material-btn outline" onClick={()=>{ if(setFile) setFile(null); if(setModel) setModel('PaddleOCR-VL-1.6'); if(setUseDocOrientationClassify) setUseDocOrientationClassify(false); if(setUseDocUnwarping) setUseDocUnwarping(false); if(setUseChartRecognition) setUseChartRecognition(false); }} onMouseDown={addRipple}>
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
                    <div style={{marginBottom:8}}><h6 style={{marginBottom:6, color:'var(--text)'}}>Current status: <span style={{color:'var(--muted)'}}>{status ?? 'idle'}</span></h6>{jobId && <div style={{fontSize:12, color:'var(--muted)'}}>Job: {jobId}</div>}</div>
                    <div className="card result-card"><div className="card-body">{results.length===0 ? <div style={{color:'var(--muted)'}}>No results yet.</div> : results.map((r,i)=>(<div key={i} style={{marginBottom:8}}>{r.text ?? JSON.stringify(r)}</div>))}</div></div>
                  </div>
                )}

                {activeTab === 'downloads' && (
                  <div className="centered-col"><div className="download-stack" style={{width:'100%'}}>{results.length===0 ? <div style={{color:'var(--muted)'}}>No results to download.</div> : results.map((r,i)=>(<div key={i} style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:8, borderBottom:'1px solid rgba(0,0,0,.04)'}}><div style={{flex:1}}>{r.text ?? `Result ${i+1}`}</div><div><button className="icon-btn" onClick={()=> handleDownloadMarkdown && handleDownloadMarkdown(i)} onMouseDown={addRipple}><FontAwesomeIcon icon={faDownload} /></button></div></div>))}</div></div>
                )}
              </div>
            </div>
          </div>
        </div>

        {showModelSettings && <div className="backdrop-blur" onClick={()=>setShowModelSettings(false)} />}
        <div className={`offcanvas-right ${showModelSettings ? 'show' : ''}`} role="dialog" aria-modal={showModelSettings}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
            <h5>Model settings</h5>
            <button className="icon-btn" onClick={()=>setShowModelSettings(false)} onMouseDown={addRipple}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>

          <div>
            <div className="form-check"><input className="form-check-input" id="orient" type="checkbox" checked={useDocOrientationClassify} onChange={(e)=> setUseDocOrientationClassify && setUseDocOrientationClassify(e.target.checked)} /> <label className="form-check-label" htmlFor="orient">Use document orientation classification</label></div>
            <div className="form-check"><input className="form-check-input" id="unwarp" type="checkbox" checked={useDocUnwarping} onChange={(e)=> setUseDocUnwarping && setUseDocUnwarping(e.target.checked)} /> <label className="form-check-label" htmlFor="unwarp">Use document unwarping</label></div>
            <div className="form-check"><input className="form-check-input" id="chart" type="checkbox" checked={useChartRecognition} onChange={(e)=> setUseChartRecognition && setUseChartRecognition(e.target.checked)} /> <label className="form-check-label" htmlFor="chart">Use chart recognition</label></div>
          </div>
        </div>

        {showFireworks && (
          <div className="fireworks-wrap">{Array.from({length:8}).map((_,i)=> <div key={i} className="firework" style={{left:`${Math.random()*100}%`, top:`${Math.random()*60+10}%`, background:['#f97316','#fb7185','#f59e0b','#60a5fa'][i%4]}} />)}</div>
        )}
      </div>
    </div>
  );
}

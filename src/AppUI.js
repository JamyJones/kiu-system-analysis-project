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

  function addRipple(e) {
    const btn = e.currentTarget;
    if (!btn) return;

    const rect = btn.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? rect.left + rect.width / 2;
    const clientY = e.clientY ?? (e.touches && e.touches[0]?.clientY) ?? rect.top + rect.height / 2;
    const size = Math.max(rect.width, rect.height) * 2;

    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${clientX - rect.left - size / 2}px`;
    ripple.style.top = `${clientY - rect.top - size / 2}px`;
    btn.appendChild(ripple);

    setTimeout(() => {
      ripple.remove();
    }, 600);
  }

  function handleReset() {
    if (setFile) setFile(null);
    if (setModel) setModel('PaddleOCR-VL-1.6');
    if (setUseDocOrientationClassify) setUseDocOrientationClassify(false);
    if (setUseDocUnwarping) setUseDocUnwarping(false);
    if (setUseChartRecognition) setUseChartRecognition(false);
  }

  const processing = status === 'submitting' || status === 'polling';

  return (
    <div className={dark ? 'app-root dark' : 'app-root'}>

      <style>{`
:root{
  --bg1:#f7fbff;
  --bg2:#e6f0ff;
  --card:#ffffff;
  --text:#0f172a;
  --muted:#475569;
  --accent:#2563eb;
  --accent-2:#06b6d4;
  --tab-bg:#f1f5f9;
  --tab-active:linear-gradient(90deg,#60a5fa,#7dd3fc);
  --submit-grad: linear-gradient(90deg,var(--accent),var(--accent-2));
}
.dark{
  --bg1:#071024;
  --bg2:#0b1220;
  --card:rgba(255,255,255,0.03);
  --text:#e6eef8;
  --muted:#94a3b8;
  --accent:#60a5fa;
  --accent-2:#7c3aed;
  --tab-bg:rgba(255,255,255,0.02);
  --tab-active:linear-gradient(90deg,#0ea5e9,#7c3aed);
  --submit-grad: linear-gradient(90deg,#0ea5e9,#7c3aed);
}

.app-root{
  min-height:100vh;
  color:var(--text);
  font-family:Inter, system-ui, Roboto, 'Helvetica Neue', Arial;
  padding:14px;
  overflow-x:hidden;
  background: transparent;
}
.bg-animated{ position:fixed; inset:0; z-index:-3; background: linear-gradient(120deg,var(--bg1),var(--bg2)); background-size:400% 400%; animation: gradientAnim 18s ease infinite; }
.dark .bg-animated{ background: linear-gradient(120deg,var(--bg1),var(--bg2)); animation: none; }
@keyframes gradientAnim{ 0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%} }

.container-mobile{ max-width:940px; margin:0 auto; position:relative; z-index:1; }

h1.title{ text-align:center; font-family: 'Segoe Script', 'Bradley Hand', cursive, serif; font-size:3rem; line-height:0.95; margin:8px 0 16px; font-weight:900; }
h1.title span{ display:block }

.topbar{ display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:12px; margin-bottom:6px; }
.top-left, .top-right { display:flex; align-items:center; }
.top-right { justify-content:flex-end; }
.icon-btn{ background:transparent; border:0; color:var(--text); padding:8px; border-radius:10px; cursor:pointer; position:relative; overflow:hidden; }
.icon-btn:active{ transform:translateY(1px); }

.ripple{ position:absolute; border-radius:50%; transform:scale(0); opacity:0.7; pointer-events:none; animation:rippleAnim .6s ease-out; background:rgba(0,0,0,0.12); }
.dark .ripple{ background:rgba(255,255,255,0.12); }
@keyframes rippleAnim{ to{ transform:scale(1); opacity:0; } }

.glass-panel{ background: linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0.46)); border-radius:16px; border:1px solid rgba(255,255,255,0.6); box-shadow:0 10px 30px rgba(16,24,40,[...] }
.dark .glass-panel{ background: linear-gradient(180deg, rgba(10,20,30,0.6), rgba(8,12,20,0.46)); border:1px solid rgba(255,255,255,0.04); box-shadow:0 14px 40px rgba(2,6,23,0.6); }

.backdrop-blur{ position:fixed; inset:0; z-index:1600; background:rgba(2,6,23,0.35); backdrop-filter:blur(6px); }
.offcanvas{ position:fixed; left:0; top:0; width:320px; max-width:92%; height:100%; background:var(--card); color:var(--text); box-shadow:0 12px 40px rgba(2,6,23,0.12); transform:translateX(-112%[...]
.offcanvas.show{ transform:translateX(0%); }
.offcanvas-right{ position:fixed; right:12px; top:80px; width:min(330px, calc(100vw - 24px)); background:var(--card); box-shadow:0 14px 36px rgba(0,0,0,0.18); border-radius:12px; padding:12px; z-[...]
.offcanvas-right.show{ display:block; }

.nav-tabs{ display:flex; gap:10px; padding:8px; background:transparent; border-bottom:none; }
.nav-tabs .nav-item{ flex:1 }
.nav-tabs .nav-link{ display:flex; align-items:center; justify-content:center; padding:12px 8px; border-radius:12px; background:var(--tab-bg); color:var(--text); font-weight:800; border:none }
.nav-tabs .nav-link.active{ background: var(--tab-active); color:#04263a; box-shadow:0 10px 28px rgba(2,6,23,0.08); }

.tab-panel{ padding:12px; display:flex; justify-content:center }
.tab-inner{ width:100%; max-width:680px }

label.form-label{ display:flex; align-items:center; gap:10px; font-weight:800; color:var(--text); }
.upload-icon{ width:18px; height:18px }
.centered-col{ display:flex; flex-direction:column; align-items:center }
.form-control[readonly]{ background:transparent; border:1px dashed rgba(0,0,0,0.06); color:var(--text) }

.material-btn{ display:inline-flex; align-items:center; justify-content:center; gap:10px; padding:12px 18px; border-radius:12px; border:none; cursor:pointer; color:white; background:var(--submit-[...]
.material-btn.outline{ background:transparent; color:var(--text); border:1px solid rgba(15,23,42,0.06); box-shadow:none }
.material-btn:active{ transform:translateY(2px) scale(.995) }

.camera-btn{ display:inline-flex; align-items:center; gap:8px; padding:10px 12px; border-radius:10px; background:rgba(2,6,23,0.06); border:none; color:var(--text); position:relative; overflow:hid[...]

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

.upload-native{ display:inline-flex; align-items:center; gap:10px; padding:12px 14px; border-radius:12px; background:rgba(255,255,255,0.9); box-shadow:0 6px 14px rgba(2,6,23,0.06); color:var(--te[...]
.dark .upload-native{ background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.04) }

@media (max-width:640px){ h1.title{ font-size:2.1rem } .nav-tabs .nav-link{ padding:10px 6px; font-size:14px } }
      `}</style>

      <div className="bg-animated" />

      {dark && (
        <div className="stars-wrap" aria-hidden>
          {Array.from({ length: 40 }).map((_, i) => {
            const left = Math.random() * 100;
            const top = Math.random() * 100;
            const delay = Math.random() * 4;
            const dur = 2 + Math.random() * 3;
            const style = {
              left: `${left}%`,
              top: `${top}%`,
              animationDelay: `${delay}s`,
              animationDuration: `${dur}s`,
              opacity: Math.random() * 0.9 + 0.1,
            };
            return <span key={i} className="star" style={style} />;
          })}
        </div>
      )}

      <div className="container-mobile">
        <div className="topbar">
          <div className="top-left">
            <button className="icon-btn" aria-label="About" onClick={() => setShowAbout(true)} onMouseDown={addRipple}>
              <FontAwesomeIcon icon={faCircleInfo} />
            </button>
          </div>

          <div className="title-wrap">
            <h1 className="title"><span>Handwriting</span><span>Digitiser</span></h1>
          </div>

          <div className="top-right">
            <button className="icon-btn" onClick={() => setDark((d) => !d)} aria-pressed={dark} onMouseDown={addRipple} aria-label="Toggle theme">
              <FontAwesomeIcon icon={dark ? faMoon : faSun} />
            </button>
          </div>
        </div>

        {showAbout && <div className="backdrop-blur" onClick={() => setShowAbout(false)} />}
        <div className={`offcanvas ${showAbout ? 'show' : ''}`} role="dialog" aria-modal={showAbout} style={{ position: 'relative', padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4>About</h4>
            <button className="icon-btn" onClick={() => setShowAbout(false)} onMouseDown={addRipple}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
          <p style={{ color: 'var(--muted)' }}>This UI submits images or documents to an OCR backend. Capture from camera on mobile, or upload files. After processing you can download results as Markd[...]
          <hr />
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>Endpoints: /ocr/jobs, /ocr/fetch, /ocr/convert, /ocr/pandoc</p>
        </div>

        {/* Status banner placed between the topbar and the main glass card */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0' }}>
          <div className="status-row" style={{ padding: '8px 12px', borderRadius: 12, background: 'var(--card)', boxShadow: '0 6px 18px rgba(2,6,23,0.06)' }}>
            <div className="spinner-wheel" aria-hidden>
              <FontAwesomeIcon icon={faGear} className={processing ? 'spin' : ''} />
            </div>
            <div>
              <div style={{ fontWeight: 800, color: 'var(--muted)' }}>{status ?? 'idle'}</div>
              {jobId && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Job: {jobId}</div>}
            </div>
          </div>
        </div>

        <div className="card mb-3 glass-panel">
          <div className="card-body">
            <ul className="nav nav-tabs mb-3" role="tablist">
              <li className="nav-item"><button className={`nav-link ${activeTab === 'input' ? 'active' : ''}`} onClick={() => setActiveTab('input')} onMouseDown={addRipple}>Input</button></li>
              <li className="nav-item"><button className={`nav-link ${activeTab === 'results' ? 'active' : ''}`} onClick={() => setActiveTab('results')} onMouseDown={addRipple}>Results</button></li>
              <li className="nav-item"><button className={`nav-link ${activeTab === 'downloads' ? 'active' : ''}`} onClick={() => setActiveTab('downloads')} onMouseDown={addRipple}>Downloads</button></li>
            </ul>

            <div style={{ padding: 12, display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: '100%', maxWidth: 680 }}>
                {activeTab === 'input' && (
                  <div className="centered-col">
                    <div style={{ width: '100%' }}>
                      <label className="form-label">Select File</label>

                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input id="fileInput" ref={fileInputRef} type="file" className="d-none" onChange={(e) => setFile && setFile(e.target.files[0])} />
                        <label htmlFor="fileInput" className="upload-native" onMouseDown={addRipple} style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 10, padding: 12 }}>
                          <FontAwesomeIcon icon={faUpload} />
                          <span style={{ fontWeight: 800 }}>Upload</span>
                        </label>

                        <input ref={cameraInputRef} style={{ display: 'none' }} accept="image/*" capture="environment" id="cameraInput" type="file" onChange={(e) => setFile && setFile(e.target.files[0])} />
                        <button className="camera-btn" onClick={() => cameraInputRef.current && cameraInputRef.current.click()} onMouseDown={addRipple} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <FontAwesomeIcon icon={faCamera} />
                          Capture
                        </button>

                        {previewUrl ? <img src={previewUrl} alt="preview" className="thumb" /> : file ? <div className="file-chip">{file.name}</div> : null}
                      </div>
                    </div>

                    <div style={{ height: 12 }} />

                    <div style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button className="icon-btn" title="Model settings" onClick={() => setShowModelSettings((s) => !s)} onMouseDown={addRipple} aria-label="Model settings">
                            <FontAwesomeIcon icon={faGear} />
                          </button>
                          <label className="form-label" style={{ margin: 0 }}>Model</label>
                        </div>

                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                          <select className="form-control" value={model} onChange={(e) => setModel && setModel(e.target.value)} style={{ flex: 1 }}>
                            {models.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>

                      </div>
                    </div>

                    <div style={{ height: 14 }} />

                    <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                      <button className="material-btn" onClick={submitJob} disabled={status === 'submitting' || status === 'polling'} onMouseDown={addRipple} style={{ padding: 12, borderRadius: 12 }}>
                        <span>Submit Job</span>
                      </button>

                      <button className="material-btn outline" onClick={handleReset} onMouseDown={addRipple}>Reset</button>

                      <div style={{ flex: 1 }} />

                    </div>
                  </div>
                )}

                {activeTab === 'results' && (
                  <div>
                    <div style={{ marginBottom: 8 }}><h6 style={{ marginBottom: 6, color: 'var(--text)' }}>Current status: <span style={{ color: 'var(--muted)' }}>{status ?? 'idle'}</span></h6>{jobId && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Job: {jobId}</div>}</div>
                    <div className="card result-card"><div className="card-body">{results.length === 0 ? <div style={{ color: 'var(--muted)' }}>No results yet.</div> : results.map((r, i) => (<div key={i} style={{ marginBottom: 8 }}><pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.text}</pre></div>))}</div></div>
                  </div>
                )}

                {activeTab === 'downloads' && (
                  <div className="centered-col"><div className="download-stack" style={{ width: '100%' }}>{results.length === 0 ? <div style={{ color: 'var(--muted)' }}>No results to download.</div> : results.map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                      <div style={{ flex: 1 }}>{r.summary ?? r.text.slice(0, 120)}</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="material-btn outline" onClick={() => handleDownloadMarkdown && handleDownloadMarkdown(r)}>Download MD</button>
                        <button className="material-btn outline" onClick={() => handleConvert && handleConvert(r)}>Convert</button>
                      </div>
                    </div>
                  ))}</div></div>
                )}
              </div>
            </div>
          </div>
        </div>

        {showModelSettings && <div className="backdrop-blur" onClick={() => setShowModelSettings(false)} />}
        <div className={`offcanvas-right ${showModelSettings ? 'show' : ''}`} role="dialog" aria-modal={showModelSettings}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h5>Model settings</h5>
            <button className="icon-btn" onClick={() => setShowModelSettings(false)} onMouseDown={addRipple}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>

          <div>
            <div className="form-check"><input className="form-check-input" id="orient" type="checkbox" checked={useDocOrientationClassify} onChange={(e) => setUseDocOrientationClassify && setUseDocOrientationClassify(e.target.checked)} /> <label className="form-check-label" htmlFor="orient">Document orientation classification</label></div>
            <div className="form-check"><input className="form-check-input" id="unwarp" type="checkbox" checked={useDocUnwarping} onChange={(e) => setUseDocUnwarping && setUseDocUnwarping(e.target.checked)} /> <label className="form-check-label" htmlFor="unwarp">Document unwarping</label></div>
            <div className="form-check"><input className="form-check-input" id="chart" type="checkbox" checked={useChartRecognition} onChange={(e) => setUseChartRecognition && setUseChartRecognition(e.target.checked)} /> <label className="form-check-label" htmlFor="chart">Chart recognition</label></div>
          </div>
        </div>

        {showFireworks && (
          <div className="fireworks-wrap">{Array.from({ length: 12 }).map((_, i) => {
            const left = Math.random() * 100;
            const top = Math.random() * 60 + 10;
            const clr = ['#f97316', '#fb7185', '#60a5fa', '#34d399', '#f43f5e', '#e879f9'][Math.floor(Math.random() * 6)];
            const delay = Math.random() * 0.8;
            const duration = 1 + Math.random() * 1.2;
            const style = {
              left: `${left}%`,
              top: `${top}%`,
              background: clr,
              animation: `fw ${duration}s ${delay}s ease-out forwards`,
            };
            return <span key={i} className="firework" style={style} />;
          })}
            <style>{`@keyframes fw{ 0%{ opacity:1; transform:scale(0);} 60%{ opacity:1; transform:scale(1.6);} 100%{ opacity:0; transform:scale(2.6) translateY(-60px);} }`}</style>
          </div>
        )}
      </div>
    </div>
  );
}

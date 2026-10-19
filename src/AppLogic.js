import { useState, useRef, useEffect } from 'react';

// Replace this with your proxy URL (no trailing slash)
const ROUTE_BASE = '/ocr';
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

export default function useAppLogic(){
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
        else if(state === 'done'){ const jsonl = j?.data?.resultUrl?.jsonUrl; if(jsonl){ setStatus('fetching-result'); await fetchJsonlAndProcess(jsonl); setStatus('done'); setShowFireworks(true); setActiveTab('results'); } else { setStatus('done'); } }
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
      for(const L of lines){
        try{
          const parsed = JSON.parse(L);
          const result = parsed.result; if(!result) continue;
          const layout = result.layoutParsingResults||[];
          for(const r of layout){
            const markdownText = r?.markdownText || r?.markdown || '';
            const markdownFilename = r?.markdownFilename || `result-${p+1}.md`;
            out.push({ markdownText, markdownFilename, markdownHtml: null, raw: r });
            p++;
          }

          // if top level has markdown
          if(result.markdownText){ out.push({ markdownText: result.markdownText, markdownFilename: `result-${p+1}.md`, markdownHtml:null, raw: result }); p++; }

        }catch(e){ log('line parse err '+e.message); }
      }
      setResults(out);

      // render markdown to html for each
      out.forEach((it, idx)=> renderMdPandoc(it.markdownText).then(html=> setResults(prev=>{ const c = prev.slice(); if(!c[idx]) return prev; c[idx] = { ...c[idx], markdownHtml: html }; return c; })));
    }catch(e){ log('Fetch/process error: '+e.message); showUserMessage('Error processing results'); }
  }

  function handleDownloadMarkdown(item){ const blob = new Blob([item.markdownText], { type:'text/markdown;charset=utf-8' }); downloadBlob(blob, item.markdownFilename); }

  function isTopLevelTable(html){ if(!html) return false; return (/^\s*<table\b/i).test(html.trim()); }

  async function handleConvert(item, format){ try{ setStatus(`converting: ${format}`); const body = { mdText: item.markdownText, format }; const resp = await fetch(`${ROUTE_BASE}/convert`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); if(!resp.ok){ const t = await resp.text(); showUserMessage(`Convert failed: ${resp.status} ${t}`); setStatus(null); return; } const blob = await resp.blob(); const ext = format==='docx'?'docx': format==='html'?'html':'pdf'; downloadBlob(blob, `${item.markdownFilename.replace(/\.md$/,'')}.${ext}`); setStatus(null); }catch(e){ log('Convert error: '+e.message); showUserMessage('Convert error'); setStatus(null); } }

  const models = ['PaddleOCR-VL-1.6','PaddleOCR-Card-1.0','PaddleOCR-Table-1.2'];

  return {
    // state
    file, setFile,
    previewUrl, setPreviewUrl,
    model, setModel,
    useDocOrientationClassify, setUseDocOrientationClassify,
    useDocUnwarping, setUseDocUnwarping,
    useChartRecognition, setUseChartRecognition,
    status, setStatus,
    jobId, setJobId,
    results, setResults,
    activeTab, setActiveTab,
    dark, setDark,
    showFireworks, setShowFireworks,
    showAbout, setShowAbout,

    // refs
    pollingRef, cameraInputRef, fileInputRef,

    // actions
    submitJob, pollJob, fetchJsonlAndProcess,
    handleDownloadMarkdown, handleConvert, isTopLevelTable,

    // misc
    models,
  };
}

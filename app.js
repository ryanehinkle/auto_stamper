/* Auto Stamper — Manager BEOs are the single source of truth.
   All processing and PDF changes happen locally in the browser. */
(() => {
  "use strict";

  const STAMPS = {
    tax:         {name:"Tax Exempt",  short:"TAX", color:"red",  width:156.9, height:20.8, hint:"Manager BEO explicitly indicates tax exemption"},
    balance:     {name:"Balance Due", short:"DUE", color:"red",  width:126.2, height:18.5, hint:"Positive outstanding balance"},
    leaderboard: {name:"Leaderboard", short:"LEADER", color:"blue",width:72.3,  height:10.0, hint:"Live Leaderboard product"},
    tentative:   {name:"Tentative",   short:"TENT", color:"red",  width:66.2,  height:12.3, hint:"Event stage is not Definite"},
    retail:      {name:"Retail",      short:"RETAIL",color:"blue",width:157.7,height:37.7, hint:"Retail section in the BEO"}
  };
  const KEYS = ["tax","balance","leaderboard","tentative","retail"];
  const $ = id => document.getElementById(id);
  const state = {files:{manager:null,internal:null},pdfs:{manager:null,internal:null},
    assets:{},events:[],internals:[],index:0,renderToken:0,toastTimer:null,busy:false};

  function escape(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function notify(message,isError=false) {
    const n=$("toast");n.textContent=message;n.classList.toggle("error",isError);n.classList.add("visible");
    clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>n.classList.remove("visible"),3700);
  }
  function setBusy(on,title,detail,percent) {
    state.busy=on;$("loading").hidden=!on;
    if(on){$("loadingTitle").textContent=title||"Processing PDFs";$("loadingSub").textContent=detail||"Please wait…";$("loadingBar").style.width=String(percent||0)+"%";}
  }
  function updateLoading(title,detail,percent) {
    $("loadingTitle").textContent=title;$("loadingSub").textContent=detail;
    $("loadingBar").style.width=percent+"%";
  }
  function init() {
    for(const role of ["manager","internal"]) {
      const drop=$(role+"Drop"),input=$(role+"Input");
      drop.addEventListener("click",()=>input.click());
      drop.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();input.click();}});
      input.addEventListener("change",()=>{if(input.files[0]) selectFile(role,input.files[0]);});
      drop.addEventListener("dragover",e=>{e.preventDefault();drop.classList.add("drag-over");});
      drop.addEventListener("dragleave",()=>drop.classList.remove("drag-over"));
      drop.addEventListener("drop",e=>{
        e.preventDefault();drop.classList.remove("drag-over");
        const f=[...(e.dataTransfer.files||[])].find(f=>f.type==="application/pdf"||f.name.toLowerCase().endsWith(".pdf"));
        if(f)selectFile(role,f);else notify("Please drop a PDF file.",true);
      });
    }
    $("startBtn").addEventListener("click",run);
    $("replaceBtn").addEventListener("click",reset);
    $("homeBtn").addEventListener("click",reset);
    $("homeBtn").addEventListener("keydown",e=>{if(e.key==="Enter")reset();});
    $("prevEvent").addEventListener("click",()=>selectEvent(state.index-1));
    $("nextEvent").addEventListener("click",()=>selectEvent(state.index+1));
    $("matchSelect").addEventListener("change",e=>setMatch(e.target.value));
    $("markReviewed").addEventListener("click",()=>{const e=selectedEvent();e.reviewed=!e.reviewed;renderAll();});
    $("downloadManager").addEventListener("click",()=>download("manager"));
    $("downloadInternal").addEventListener("click",()=>download("internal"));
    $("downloadBoth").addEventListener("click",()=>download("both"));
    $("downloadBothTop").addEventListener("click",()=>download("both"));
    document.addEventListener("keydown",e=>{
      if($("workspace").hidden||/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName))return;
      if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();selectEvent(state.index+(e.key==="ArrowRight"?1:-1));}
    });
    if(!window.pdfjsLib||!window.PDFLib||!window.JSZip){
      $("landingError").hidden=false;$("landingError").textContent="PDF libraries could not be loaded. Check your internet connection and reload.";
      $("startBtn").disabled=true;
    } else {
      pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }
  }
  function selectFile(role,file) {
    if(!/\.pdf$/i.test(file.name)&&file.type!=="application/pdf"){notify("Please select a PDF.",true);return;}
    state.files[role]=file;
    $(role+"FileLabel").textContent=file.name;
    $(role+"FileStatus").textContent="✓ Ready";
    $(role+"Drop").classList.add("loaded");
    const ready=!!(state.files.manager&&state.files.internal);
    $("startBtn").disabled=!ready||!window.pdfjsLib||!window.PDFLib;
    $("startBtn").textContent=ready?"Analyze BEOs":"Upload both PDFs";
    $("landingError").hidden=true;
  }
  function reset() {
    if(state.busy)return;
    state.events=[];state.internals=[];state.index=0;state.pdfs={manager:null,internal:null};
    state.files={manager:null,internal:null};state.renderToken++;
    for(const role of ["manager","internal"]) {
      $(role+"Input").value="";$(role+"Drop").classList.remove("loaded");
      $(role+"FileLabel").textContent="Choose or drop a PDF";$(role+"FileStatus").textContent="Select PDF";
    }
    $("startBtn").disabled=true;$("startBtn").textContent="Upload both PDFs";
    $("workspace").hidden=true;$("landing").hidden=false;window.scrollTo(0,0);
  }
  async function loadAssets() {
    for(const key of KEYS) {
      if(state.assets[key])continue;
      const response=await fetch("stamps/"+key+".b64",{cache:"force-cache"});
      if(!response.ok)throw new Error("Missing original "+STAMPS[key].name+" stamp asset.");
      const base64=(await response.text()).trim();
      const binary=atob(base64);
      const png=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++)png[i]=binary.charCodeAt(i);
      const image=new Image();
      await new Promise((resolve,reject)=>{
        image.onload=resolve;image.onerror=()=>reject(new Error("Could not read the "+key+" stamp."));
        image.src="data:image/png;base64,"+base64;
      });
      state.assets[key]={png,image};
    }
  }
  function linesFromContent(content,height) {
    const items=content.items.filter(i=>i.str&&i.str.trim()).map(i=>({s:i.str.trim(),x:i.transform[4],y:height-i.transform[5]}));
    items.sort((a,b)=>a.y-b.y||a.x-b.x);
    const lines=[];
    for(const i of items) {
      let row=lines[lines.length-1];
      if(!row||Math.abs(row.y-i.y)>3.6){row={y:i.y,parts:[]};lines.push(row);}
      row.parts.push(i);
    }
    return lines.map(row=>row.parts.sort((a,b)=>a.x-b.x).map(v=>v.s).join(" ").replace(/\s+/g," ").trim());
  }
  function readInfo(text,lines) {
    const id=(text.match(/\bBEO\s*(?:#|No\.?|Number)\s*:?\s*(\d{4,})\b/i)||[])[1]||null;
    const card=(text.match(/\bEVENT\s+CARD\s*(?:#|\/PARTY\s*ID|ID)?\s*:?\s*(\d{3,})\b/i)||[])[1]||null;
    const opp=(text.match(/\bOpportunity\s+ID\s*:?\s*([a-zA-Z0-9]{8,})/i)||[])[1]||null;
    const pm=text.match(/\bPage\s+(\d+)\s+of\s+(\d+)/i);
    const pageNo=pm?Number(pm[1]):null,pageTotal=pm?Number(pm[2]):null;
    let name="",date="";
    for(const line of lines.slice(0,32)) {
      const m=line.match(/(.{4,105}?)\s*-\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/);
      if(m&&!/Date Printed|Opportunity|Event Date/i.test(m[1])){
        name=m[1].trim().replace(/\s+Event.*$/i,"");date=m[2];break;
      }
    }
    if(!name)name=(text.match(/\bEvent\s+Name\s*:\s*([^\n]+)/i)||text.match(/\bAccount\s*:\s*([^\n]+)/i)||[])[1]||"";
    name=name.replace(/\s*(?:Event Date|Event Day|Event Time|Account):.*$/i,"").slice(0,100).trim();
    if(!date)date=(text.match(/\bEvent\s+Date\s*:\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i)||[])[1]||"";
    return {id,card,opp,pageNo,pageTotal,name,date};
  }
  async function parsePdf(file,role,onPage) {
    const bytes=new Uint8Array(await file.arrayBuffer());
    let doc;
    try{doc=await pdfjsLib.getDocument({data:new Uint8Array(bytes)}).promise;}
    catch(e){throw new Error("Could not open "+file.name+". "+(e.message||"The PDF may be password protected."));}
    const pages=[];
    for(let n=1;n<=doc.numPages;n++){
      const p=await doc.getPage(n);
      let content;
      try{content=await p.getTextContent();}catch(e){content={items:[]};}
      const lines=linesFromContent(content,p.view[3]-p.view[1]);
      const text=lines.join("\n");
      pages.push({index:n-1,text,lines,info:readInfo(text,lines),width:p.view[2]-p.view[0],height:p.view[3]-p.view[1]});
      if(onPage)onPage(n,doc.numPages);
    }
    const groups=groupPages(pages,role);
    return {file,bytes,doc,pages,groups};
  }
  function groupPages(pages,role){
    const groups=[];let last=null;
    for(const p of pages){
      const info=p.info;
      const sameId=last&&info.id&&last.beo&&info.id===last.beo;
      const continuing=last&&((sameId&&info.pageNo!==1)||
        (!info.id&&info.pageNo&&info.pageNo>1&&last.pages.length<last.expectedPages)||
        (!info.id&&!info.name&&!info.pageNo&&last.pages.length<last.expectedPages));
      if(continuing){
        last.pages.push(p.index);last.text+="\n"+p.text;
        if(!last.name&&info.name)last.name=info.name;
        if(!last.date&&info.date)last.date=info.date;
        if(!last.card&&info.card)last.card=info.card;
        continue;
      }
      last={key:role.charAt(0)+String(groups.length),pages:[p.index],beo:info.id,card:info.card,opp:info.opp,name:info.name||"Event "+(groups.length+1),date:info.date||"",expectedPages:info.pageTotal||1,text:p.text,flags:{},detected:{},reasons:{},match:"",reviewed:false};
      groups.push(last);
    }
    return groups;
  }
  function numberFromLine(line) {
    let tail=line.replace(/^.*?(?:balance\s+due|remaining\s+balance|outstanding\s+balance|amount\s+due)\s*:?\s*/i,"");
    const match=tail.match(/(?:USD\s*)?\$?\s*(-?[\d,]+\.\d{2})(?!\d)/i);
    return match?Number(match[1].replace(/,/g,"")):null;
  }
  function detect(group) {
    const text=group.text;
    const lines=text.split(/\n/);
    const result={tax:null,balance:null,leaderboard:false,tentative:null,retail:false};
    const reasons={};
    const balances=lines.filter(l=>/\b(?:balance\s+due|remaining\s+balance|outstanding\s+balance|amount\s+due)\b/i.test(l));
    const parsed=balances.map(numberFromLine).filter(n=>n!==null&&Number.isFinite(n));
    if(parsed.length){
      const due=parsed[parsed.length-1];result.balance=due>0.005;
      reasons.balance="Balance due: "+formatMoney(due);
    } else {
      reasons.balance="No explicit remaining balance found. Check the payment summary.";
    }
    const taxLines=lines.filter(l=>/\b(?:tax[-\s]*exempt|tax\s+exemption|exempt\s+from\s+tax)\b/i.test(l));
    if(taxLines.length){
      const t=taxLines[0];
      if(/\b(?:no|false|not\s+exempt|non[-\s]exempt)\b/i.test(t))result.tax=false;
      else if(/\b(?:yes|true|exempt)\b/i.test(t))result.tax=true;
      reasons.tax=t.slice(0,100);
    } else {
      const status=(text.match(/\bTax\s+(?:Status|Treatment)\s*:\s*([^\n]{1,36})/i)||[])[1];
      if(status){result.tax=/\bexempt\b/i.test(status);reasons.tax="Tax status: "+status.slice(0,55);}
      else reasons.tax="Tax exemption not explicitly stated. Verify before exporting.";
    }
    result.leaderboard=/\bLive\s+Leader\s*board\b/i.test(text);
    reasons.leaderboard=result.leaderboard?"Live Leaderboard product found":"No Live Leaderboard product found";
    result.retail=lines.some(l=>/^\s*Retail\s*$/i.test(l)||/\bRetail\s+TOTAL\s*:/i.test(l));
    reasons.retail=result.retail?"Retail section found":"No Retail section found";
    const statusLine=lines.find(l=>/\b(?:Event\s+Status|Event\s+Stage|Opportunity\s+Stage|Stage)\s*:/i.test(l));
    if(statusLine){
      const m=statusLine.match(/\b(?:Event\s+Status|Event\s+Stage|Opportunity\s+Stage|Stage)\s*:\s*(.{2,65})/i);
      if(m) {
        const s=m[1].split(/\b(?:Event Guest Count|Event Sales Manager|Event Date|Booking Type)\s*:/i)[0].trim();
        result.tentative=!/\bdefinite\b/i.test(s);
        reasons.tentative="Event status: "+s.slice(0,65);
      }
    }
    if(result.tentative===null)reasons.tentative="Event status not found. Check whether the event is Definite.";
    group.detected=result;
    group.flags=Object.fromEntries(KEYS.map(k=>[k,result[k]===true]));
    group.reasons=reasons;
  }
  function formatMoney(n){return n.toLocaleString("en-US",{style:"currency",currency:"USD"});}
  function normalizeName(s){return (s||"").toLowerCase().replace(/\b(?:manager|internal|catering|event|beo)\b/g,"").replace(/[^a-z0-9]+/g," ").trim();}
  function normalizeDate(s) {
    const m=String(s||"").match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if(!m)return "";
    return String(+m[1])+"/"+String(+m[2])+"/"+String(m[3]).slice(-2);
  }
  function similarity(a,b) {
    if(!a||!b)return 0;if(a===b)return 1;
    const x=new Set(a.split(" ")),y=new Set(b.split(" "));let common=0;
    for(const token of x)if(y.has(token))common++;
    return common/(x.size+y.size-common||1);
  }
  function autoMatch(events,internals) {
    const used=new Set();
    for(const m of events){
      let best=null,bestScore=0;
      for(const i of internals){
        if(used.has(i.key))continue;
        let score=0;
        if(m.beo&&i.beo&&m.beo===i.beo)score=100;
        else if(m.opp&&i.opp&&m.opp===i.opp)score=99;
        else if(m.card&&i.card&&m.card===i.card)score=98;
        else{
          const names=similarity(normalizeName(m.name),normalizeName(i.name));
          const dates=normalizeDate(m.date)&&normalizeDate(m.date)===normalizeDate(i.date);
          if(names===1&&dates)score=95;
          else if(names>=.92&&dates)score=90;
          else if(names===1&&!m.date&&!i.date)score=85;
        }
        if(score>bestScore){bestScore=score;best=i;}
      }
      m.match=bestScore>=85?best.key:"";
      m.matchScore=bestScore;
      if(m.match)used.add(m.match);
    }
  }
  async function run(){
    if(state.busy||!state.files.manager||!state.files.internal)return;
    $("landingError").hidden=true;setBusy(true,"Reading Manager BEOs","Analyzing the source packet…",5);
    try{
      await loadAssets();updateLoading("Reading Manager BEOs","Finding events and product details…",12);
      state.pdfs.manager=await parsePdf(state.files.manager,"manager",(n,total)=>updateLoading("Reading Manager BEOs",n+" of "+total+" pages",12+30*n/total));
      updateLoading("Reading Internal BEOs","Matching copies…",47);
      state.pdfs.internal=await parsePdf(state.files.internal,"internal",(n,total)=>updateLoading("Reading Internal BEOs",n+" of "+total+" pages",47+30*n/total));
      state.events=state.pdfs.manager.groups;state.internals=state.pdfs.internal.groups;
      if(!state.events.length)throw new Error("There were no pages in the Manager BEO PDF.");
      for(const e of state.events)detect(e);
      autoMatch(state.events,state.internals);
      state.index=0;
      updateLoading("Building previews","Aligning the scanned stamp impressions…",90);
      $("landing").hidden=true;$("workspace").hidden=false;window.scrollTo(0,0);
      $("managerStripName").textContent=state.files.manager.name;
      $("internalStripName").textContent=state.files.internal.name;
      $("managerStripCount").textContent=state.pdfs.manager.pages.length+" pages";
      $("internalStripCount").textContent=state.pdfs.internal.pages.length+" pages";
      $("sourceCount").textContent="Manager + Internal BEOs";
      renderAll();
      const noText=state.pdfs.manager.pages.every(p=>!p.text.trim());
      if(noText)notify("This Manager PDF is scanned: select stamps manually; automatic text detection is unavailable.",true);
      else if(state.events.some(e=>!e.match))notify("Some events need an Internal BEO match. Review before exporting.",true);
      else notify("BEOs analyzed. Check the stamp suggestions before exporting.");
    }catch(e){
      console.error(e);$("landing").hidden=false;$("workspace").hidden=true;
      $("landingError").hidden=false;$("landingError").textContent=e.message||"An unexpected error occurred.";
      notify(e.message||"Could not process the PDFs.",true);
    }finally{setBusy(false);}
  }
  function countReview(e) {
    return !e.match||(!e.reviewed&&KEYS.some(k=>e.detected[k]===null));
  }
  function renderSummary(){
    $("eventTotal").textContent=state.events.length;
    $("stampTotal").textContent=state.events.reduce((s,e)=>s+KEYS.filter(k=>e.flags[k]).length,0);
    $("matchedTotal").textContent=state.events.filter(e=>e.match).length+" / "+state.events.length;
    $("reviewTotal").textContent=state.events.filter(countReview).length;
    $("eventListCount").textContent=state.events.length+" event"+(state.events.length===1?"":"s");
  }
  function renderList(){
    const root=$("eventList");root.innerHTML="";
    state.events.forEach((e,i)=>{
      const button=document.createElement("button");
      button.className="event-item"+(state.index===i?" selected":"");
      const chosen=KEYS.filter(k=>e.flags[k]);
      let pills=chosen.map(k=>'<span class="event-chip '+(STAMPS[k].color==="red"?"red":"")+'">'+escape(STAMPS[k].short)+'</span>').join("");
      if(!pills)pills='<span class="event-chip empty">NO STAMPS</span>';
      button.innerHTML='<div class="event-index"><span>EVENT '+String(i+1).padStart(2,"0")+'</span><span class="'+(countReview(e)?"needs-review":"")+'">'+(countReview(e)?"● REVIEW":"✓ MATCHED")+'</span></div>'+
        '<div class="event-name">'+escape(e.name)+'</div><div class="event-desc">'+escape(e.date||"Date not detected")+(e.beo?" · BEO #"+escape(e.beo):"")+'</div><div class="event-stamps">'+pills+"</div>";
      button.addEventListener("click",()=>selectEvent(i));root.appendChild(button);
    });
  }
  function selectedEvent(){return state.events[state.index];}
  function internalFor(e){return state.internals.find(i=>i.key===e.match)||null;}
  function selectEvent(index) {
    if(index<0||index>=state.events.length||index===state.index)return;
    state.index=index;renderAll();
  }
  function setMatch(key){
    const e=selectedEvent();
    if(key&&state.events.some(other=>other!==e&&other.match===key)){
      notify("That Internal BEO is already matched to a different event.",true);
      renderInspector();return;
    }
    e.match=key;renderAll();
  }
  function renderInspector(){
    const e=selectedEvent();if(!e)return;
    $("reviewBadge").hidden=!countReview(e);
    $("markReviewed").textContent=e.reviewed?"✓ Reviewed":"Mark as reviewed";
    $("markReviewed").classList.toggle("reviewed",e.reviewed);
    const checks=$("stampChecks");checks.innerHTML="";
    for(const key of KEYS){
      const stamp=STAMPS[key],checked=!!e.flags[key],detected=e.detected[key];
      const button=document.createElement("button");button.type="button";
      button.className="stamp-option"+(checked?" checked":"");
      button.setAttribute("aria-pressed",String(checked));
      const status=detected===null?"Needs review":detected?"Detected":"Not detected";
      button.innerHTML='<span class="stamp-box">✓</span><span class="stamp-copy"><strong>'+escape(stamp.name)+'</strong><small>'+escape(status)+'</small></span>'+
        '<img class="stamp-mini '+key+'" alt="" src="'+escape(state.assets[key].image.src)+'">';
      button.addEventListener("click",()=>{e.flags[key]=!e.flags[key];renderAll();});
      checks.appendChild(button);
    }
    const select=$("matchSelect");select.innerHTML='<option value="">— Not matched —</option>';
    state.internals.forEach(i=>{
      const option=document.createElement("option");option.value=i.key;
      option.textContent=(i.beo?"#"+i.beo+" · ":"")+i.name+(i.date?" · "+i.date:"");
      select.appendChild(option);
    });
    select.value=e.match||"";
    const msg=$("matchMessage");
    msg.className="match-message"+(!e.match?" warn":"");
    msg.textContent=e.match?(e.matchScore>=90?"Matched automatically using event identifiers.":"This Internal BEO will receive the same stamps."):"Choose the matching Internal BEO. Unmatched copies will not be stamped.";
    const details=$("detectionDetails");details.innerHTML="";
    for(const key of KEYS){
      const val=e.detected[key],row=document.createElement("div");row.className="detection-row";
      row.innerHTML='<span>'+escape(STAMPS[key].name)+'</span><b class="'+(val===null?"unknown":val?"yes":"")+'" title="'+escape(e.reasons[key]||"")+'">'+
        escape(val===null?"Verify":val?"Found":"No")+'</b>';details.appendChild(row);
      const reason=document.createElement("div");reason.className="section-note";
      reason.style.marginTop="-5px";reason.textContent=e.reasons[key]||"";
      details.appendChild(reason);
    }
  }
  function renderAll(){
    const e=selectedEvent();if(!e)return;
    renderSummary();renderList();renderInspector();
    $("currentEventTitle").textContent=e.name;
    $("currentEventMeta").textContent=(e.date||"Date unknown")+(e.beo?" · BEO #"+e.beo:"")+
      " · "+KEYS.filter(k=>e.flags[k]).length+" stamp(s)";
    $("eventPager").textContent=(state.index+1)+" / "+state.events.length;
    $("prevEvent").disabled=state.index===0;$("nextEvent").disabled=state.index===state.events.length-1;
    renderPreviews();
  }
  function placement(e,pageWidth,pageHeight){
    const factor=Math.min(pageWidth/612,pageHeight/792);
    const toStamp=key=>({key,w:STAMPS[key].width*factor,h:STAMPS[key].height*factor});
    const center=pageWidth/2,small=["tentative","leaderboard"].filter(k=>e.flags[k]);
    const big=["tax","balance"].filter(k=>e.flags[k]);
    let rows=big.map(k=>[toStamp(k)]);
    if(small.length)rows.push(small.map(toStamp));
    const retail=e.flags.retail?toStamp("retail"):null;
    const rowHeight=r=>Math.max(...r.map(s=>s.h));
    const rowTotal=r=>r.reduce((sum,row)=>sum+rowHeight(row),0)+Math.max(0,r.length-1)*5*factor;
    const tryAll=retail?[...rows,[retail]]:rows;
    const retailOnTop=!!retail&&rowTotal(tryAll)<=72*factor;
    if(retailOnTop)rows=tryAll;
    const out=[],total=rowTotal(rows);
    let y=39*factor+Math.max(0,(70*factor-total)*.22);
    for(const row of rows){
      const maxH=rowHeight(row),gap=9*factor;
      const totalW=row.reduce((sum,s)=>sum+s.w,0)+(row.length-1)*gap;
      let x=center-totalW/2;
      for(const s of row){out.push({key:s.key,x,top:y+(maxH-s.h)/2,w:s.w,h:s.h});x+=s.w+gap;}
      y+=maxH+5*factor;
    }
    if(retail&&!retailOnTop){
      // The white band between the staffing table and first product section.
      // Centered and level, as demonstrated in the scanned references.
      out.push({key:"retail",x:center-retail.w/2,top:294*factor,w:retail.w,h:retail.h});
    }
    return out;
  }
  async function paintPage(canvas,packet,pageIndex,event,token){
    const page=await packet.doc.getPage(pageIndex+1);
    if(token!==state.renderToken)return;
    const viewport=page.getViewport({scale:1.35});
    // Render offscreen to prevent rapid event navigation from reusing a busy canvas.
    const buffer=document.createElement("canvas");
    buffer.width=Math.round(viewport.width);buffer.height=Math.round(viewport.height);
    const ctx=buffer.getContext("2d",{alpha:false});
    ctx.fillStyle="#fff";ctx.fillRect(0,0,buffer.width,buffer.height);
    await page.render({canvasContext:ctx,viewport}).promise;
    if(token!==state.renderToken)return;
    // Preview and exported PDF use the same positioned RGBA stamp impressions.
    for(const s of placement(event,page.view[2]-page.view[0],page.view[3]-page.view[1])){
      ctx.drawImage(state.assets[s.key].image,s.x*1.35,s.top*1.35,s.w*1.35,s.h*1.35);
    }
    if(token!==state.renderToken)return;
    canvas.width=buffer.width;canvas.height=buffer.height;
    canvas.getContext("2d").drawImage(buffer,0,0);
  }
  async function renderPreviews(){
    const e=selectedEvent(),token=++state.renderToken;
    const m=state.pdfs.manager,i=state.pdfs.internal,match=internalFor(e);
    $("managerPageLabel").textContent="Page "+(e.pages[0]+1)+" of "+m.pages.length;
    $("internalPageLabel").textContent=match?"Page "+(match.pages[0]+1)+" of "+i.pages.length:"No match";
    $("noInternal").hidden=!!match;
    $("internalCanvas").hidden=!match;
    try{
      const promises=[paintPage($("managerCanvas"),m,e.pages[0],e,token)];
      if(match)promises.push(paintPage($("internalCanvas"),i,match.pages[0],e,token));
      await Promise.all(promises);
    }catch(err){console.error(err);notify("Could not render a PDF preview.",true);}
  }
  function stampedName(role){
    const day=state.events[0]&&normalizeDate(state.events[0].date);
    const d=day?day.split("/"):[String(new Date().getMonth()+1),String(new Date().getDate()),String(new Date().getFullYear()).slice(-2)];
    const stampDate=d.map((part,j)=>j<2?String(+part).padStart(2,"0"):part).join(".");
    return (role==="manager"?"Manager BEOs":"Internal BEOs")+" Stamped "+stampDate+".pdf";
  }
  async function createPdf(role) {
    const packet=state.pdfs[role];
    const pdf=await PDFLib.PDFDocument.load(packet.bytes.slice(),{updateMetadata:false});
    const images={};
    for(const key of KEYS)images[key]=await pdf.embedPng(state.assets[key].png);
    const allPages=pdf.getPages();
    for(const e of state.events){
      const target=role==="manager"?e:internalFor(e);
      if(!target||!target.pages.length)continue;
      const page=allPages[target.pages[0]];
      if(!page)continue;
      for(const s of placement(e,page.getWidth(),page.getHeight())) {
        page.drawImage(images[s.key],{x:s.x,y:page.getHeight()-s.top-s.h,width:s.w,height:s.h});
      }
    }
    return await pdf.save({useObjectStreams:true});
  }
  function saveBlob(blob,name){
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),20000);
  }
  async function download(role){
    if(state.busy||!state.pdfs.manager||!state.pdfs.internal)return;
    const unmatched=state.events.filter(e=>!e.match).length;
    if(unmatched)notify(unmatched+" event(s) have no Internal match. They will be skipped in the Internal copy.",true);
    const unreviewed=state.events.filter(e=>!e.reviewed&&KEYS.some(k=>e.detected[k]===null)).length;
    if(unreviewed&&!window.confirm(unreviewed+" event(s) still have uncertain stamp detection. Continue exporting without reviewing them?"))return;
    setBusy(true,"Stamping PDFs","Embedding the original stamp impressions…",8);
    try{
      if(role==="both"){
        const a=await createPdf("manager");updateLoading("Stamping PDFs","Preparing Internal copy…",48);
        const b=await createPdf("internal");updateLoading("Packaging PDFs","Preserving both original packet layouts…",83);
        const zip=new JSZip();
        zip.file(stampedName("manager"),a);zip.file(stampedName("internal"),b);
        const blob=await zip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:5}});
        saveBlob(blob,"Auto Stamper - "+stampedName("manager").replace("Manager BEOs Stamped ","").replace(".pdf","")+".zip");
      }else{
        const bytes=await createPdf(role);
        saveBlob(new Blob([bytes],{type:"application/pdf"}),stampedName(role));
      }
      notify("Stamped PDF"+(role==="both"?"s":"")+" downloaded.");
    }catch(e){console.error(e);notify("PDF export failed: "+(e.message||"Unknown error"),true);}
    finally{setBusy(false);}
  }
  window.addEventListener("DOMContentLoaded",init);
})();
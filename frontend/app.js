// ===== Config: backend sullo stesso host, porta 8470 (CORS aperto).
//       Con proxy nginx /api → backend, sostituisci con: const API = "/api";
const API = `${location.protocol}//${location.hostname}:8470/api`;
const HEALTH = `${location.protocol}//${location.hostname}:8470/health`;
 
let DEMO = false;
let projects = [];
let categories = [];
let catMap = {};
let currentFilter = "all";
let sortKey = "updated_at";   // colonna di ordinamento iniziale
let sortDir = "desc";         // "asc" | "desc"
let components = [];
let compFilter = "all";       // filtro stato componente
let compProj = "all";         // filtro progetto
let activeShop = null;        // negozio selezionato dalla lista spesa
let editingProjectId = null;  // progetto aperto nella scheda di modifica
let shopData = [];            // cache riepilogo lista spesa
let lists = [];               // liste personalizzate
let activeListId = null;      // lista aperta
let listItems = [];           // voci della lista aperta
let draftFields = [];         // editor campi nel modale lista
let draftDeleted = [];        // id campi esistenti rimossi (da confermare al salvataggio)
let demoItems = {};           // demo: voci per lista
let itemFilters = {};         // filtri attivi sulle voci, per chiave campo
let popKey = null;            // campo del popover filtro aperto
let dragFrom = null;          // indice riga campo trascinata (editor lista)

// Oltre questa soglia un campo numerico passa da "valori presenti" a intervallo min/max
const NUM_PICK_MAX = 25;
 
const ST_LABEL = {new:"Nuovo",active:"Attivo", paused:"In pausa", done:"Completato"};
const PR_LABEL = {high:"Alta", medium:"Media", low:"Bassa"};
const PR_RANK  = {high:0, medium:1, low:2};
const CS_LABEL = {to_buy:"Da comprare", ordered:"Ordinato", delivered:"Consegnato", cancelled:"Annullato"};
const FT_LABEL = {text:"Testo", number:"Numero", boolean:"Sì/No", date:"Data", url:"Link", select:"Scelta", rating:"Voto 0-10"};
function fmtEur(v){ return (v==null||v==="")?"—":Number(v).toLocaleString("it-IT",{style:"currency",currency:"EUR"}); }
const PALETTE = ["#3d7bfd","#f6c454","#a78bfa","#34d399","#f87171","#22d3ee","#fb923c","#e879f9","#60a5fa","#a3e635"];
 
const $ = id => document.getElementById(id);
const esc = s => (s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function rgba(hex,a){const h=hex.replace("#","");const n=parseInt(h.length===3?h.replace(/(.)/g,"$1$1"):h,16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`}
function slug(s){return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"cat"}
// Le date dal backend sono UTC ("YYYY-MM-DD HH:MM:SS"): le interpretiamo come tali e le mostriamo in ora locale.
function parseDate(s){ if(!s) return null; const d=new Date(s.includes("T")?s:s.replace(" ","T")+"Z"); return isNaN(d)?null:d; }
function fmtDate(s){
  const d=parseDate(s);
  if(!d) return {short:"—",full:""};
  return {
    short:d.toLocaleString("it-IT",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}),
    full :d.toLocaleString("it-IT",{dateStyle:"full",timeStyle:"medium"})
  };
}
 
// form refs
const f={pId:$("p-id"),pName:$("p-name"),pCat:$("p-category"),pStatus:$("p-status"),pNotes:$("p-notes"),
         cId:$("c-id"),cLabel:$("c-label"),cColor:$("c-color"),
         kId:$("k-id"),kName:$("k-name"),kProject:$("k-project"),kShop:$("k-shop"),kQty:$("k-qty"),
         kPrice:$("k-price"),kPriority:$("k-priority"),kStatus:$("k-status"),kUrl:$("k-url"),kDesc:$("k-desc")};
 
// ---------- API ----------
async function api(path,opts={}){
  if(DEMO) return mockApi(path,opts);
  const res=await fetch(API+path,{headers:{"Content-Type":"application/json"},...opts});
  if(!res.ok) throw new Error((await res.json().catch(()=>({}))).detail||res.statusText);
  return res.status===204?null:res.json();
}
function withCounts(){ return categories.map(c=>({...c,project_count:projects.filter(p=>p.category===c.key).length})); }
function joinComp(c){ const p=projects.find(x=>x.id===c.project_id)||{}; return {...c,project_name:p.name||"—",project_category:p.category||"other"}; }
function compsWithJoin(){ return components.map(joinComp); }
function shopSummaryDemo(){
  const agg={};
  components.filter(c=>c.status==="to_buy").forEach(c=>{ const k=(c.shop&&c.shop.trim())||"—";
    agg[k]=agg[k]||{shop:k,items:0,total:0}; agg[k].items++; agg[k].total+=(Number(c.estimated_price)||0)*(c.quantity||1); });
  return Object.values(agg).sort((a,b)=>b.total-a.total||b.items-a.items);
}
function mockApi(path,opts={}){
  const m=(opts.method||"GET").toUpperCase();
  if(path.startsWith("/lists")) return mockLists(path,m,opts);
  if(path==="/projects"&&m==="GET") return [...projects];
  if(path==="/projects"&&m==="POST"){const b=JSON.parse(opts.body);b.id=Math.max(0,...projects.map(p=>p.id))+1;
    const now=new Date().toISOString().slice(0,19).replace("T"," ");b.created_at=now;b.updated_at=now;projects.unshift(b);return b;}
  if(path==="/categories"&&m==="GET") return withCounts();
  if(path==="/categories"&&m==="POST"){const b=JSON.parse(opts.body);
    let k=slug(b.label),i=1;while(categories.some(c=>c.key===k)){i++;k=slug(b.label)+"-"+i;}
    const cat={id:Math.max(0,...categories.map(c=>c.id))+1,key:k,label:b.label,color:b.color||PALETTE[categories.length%PALETTE.length],project_count:0};
    categories.push(cat);return cat;}
  if(path==="/components"&&m==="GET") return compsWithJoin();
  if(path==="/components"&&m==="POST"){const b=JSON.parse(opts.body);b.id=Math.max(0,...components.map(c=>c.id))+1;
    b.created_at=new Date().toISOString().slice(0,19).replace("T"," ");components.unshift(b);return joinComp(b);}
  if(path==="/shopping-list/summary"&&m==="GET") return shopSummaryDemo();
  const id=parseInt(path.split("/")[2]||0);
  if(path.startsWith("/projects/")){const i=projects.findIndex(p=>p.id===id);
    if(m==="PATCH"){Object.assign(projects[i],JSON.parse(opts.body));projects[i].updated_at=new Date().toISOString().slice(0,19).replace("T"," ");return projects[i];}
    if(m==="DELETE"){projects.splice(i,1);components=components.filter(c=>c.project_id!==id);return null;}}
  if(path.startsWith("/components/")){const i=components.findIndex(c=>c.id===id);
    if(m==="PATCH"){Object.assign(components[i],JSON.parse(opts.body));return joinComp(components[i]);}
    if(m==="DELETE"){components.splice(i,1);return null;}}
  if(path.startsWith("/categories/")){const i=categories.findIndex(c=>c.id===id);
    if(m==="PATCH"){Object.assign(categories[i],JSON.parse(opts.body));return categories[i];}
    if(m==="DELETE"){const used=projects.filter(p=>p.category===categories[i].key).length;
      if(used) throw new Error(`Categoria in uso da ${used} progetto/i. Riassegnali prima di eliminarla.`);
      categories.splice(i,1);return null;}}
  return null;
}
 
// ---------- Connessione ----------
async function checkConn(){
  const c=$("conn"),t=$("connText");
  try{const r=await fetch(HEALTH);if(!r.ok)throw 0;const j=await r.json();
    c.className="conn online";t.textContent=`backend online · v${j.version}`;
  }catch(e){DEMO=true;c.className="conn demo";t.textContent="demo (offline)";
    $("demoBanner").classList.add("show");
    categories=[{id:1,key:"hardware",label:"Hardware",color:"#f6c454"},{id:2,key:"software",label:"Software",color:"#3d7bfd"},
                {id:3,key:"music",label:"Musica",color:"#a78bfa"},{id:4,key:"other",label:"Altro",color:"#7b8694"}];
    projects=[{id:1,name:"NASGUL",category:"hardware",status:"active",notes:"Home server OMV. Pico ATX + Mean Well, ~49W.",created_at:"2026-03-12 09:20:00",updated_at:"2026-05-30 18:42:00"},
              {id:2,name:"GILPA",category:"software",status:"active",notes:"Assistente personale self-hosted. In costruzione.",created_at:"2026-05-18 21:05:00",updated_at:"2026-06-02 14:15:00"},
              {id:3,name:"Album Lia",category:"music",status:"paused",notes:"Sessioni da riprendere.",created_at:"2026-01-08 11:00:00",updated_at:"2026-02-14 17:30:00"},
              {id:4,name:"Domotica Zigbee",category:"other",status:"active",notes:"Lista componenti da definire.",created_at:"2026-04-22 08:10:00",updated_at:"2026-04-22 08:10:00"}];
    components=[
      {id:1,project_id:1,name:"PicoPSU RGEEK 1106",description:"DC-DC 160W",shop:"Amazon",url:null,estimated_price:24.9,quantity:1,priority:"high",status:"delivered",created_at:"2026-03-15 10:00:00"},
      {id:2,project_id:1,name:"Mean Well LRS-150-12",description:"Alimentatore 12V open frame",shop:"Amazon",url:null,estimated_price:19.9,quantity:1,priority:"high",status:"to_buy",created_at:"2026-05-20 10:00:00"},
      {id:3,project_id:4,name:"Sensore movimento Zigbee",description:"Aqara P1",shop:"AliExpress",url:null,estimated_price:6.5,quantity:3,priority:"medium",status:"to_buy",created_at:"2026-04-25 10:00:00"},
      {id:4,project_id:4,name:"Kit resistenze 10k",description:null,shop:"Action",url:null,estimated_price:2.0,quantity:1,priority:"low",status:"to_buy",created_at:"2026-04-25 10:05:00"},
      {id:5,project_id:2,name:"Dominio (opzionale)",description:"Accesso via IP Tailscale, non necessario",shop:"",url:null,estimated_price:null,quantity:1,priority:"low",status:"cancelled",created_at:"2026-05-19 10:00:00"}];
    demoSeedLists();}
}
 
// ---------- Load ----------
async function loadAll(){
  try{ categories=await api("/categories"); projects=await api("/projects"); components=await api("/components");
       lists=await api("/lists");
       if(activeListId && !lists.some(l=>l.id===activeListId)) activeListId=null;
       listItems = activeListId ? await api(`/lists/${activeListId}/items`) : []; }
  catch(e){ toast("Errore nel caricamento","err"); }
  rebuildCatMap(); renderAll();
}
function rebuildCatMap(){ catMap={}; categories.forEach(c=>catMap[c.key]=c); }
function renderAll(){ renderProjects(); renderCategories(); renderComponents(); populateCatSelect(); populateProjectSelects(); refreshShopSummary(); refreshProjectComponentsPanel(); renderLists(); }
 
// ---------- Render: categoria chip ----------
function catChip(key){
  const c=catMap[key]||{label:key,color:"#7b8694"};
  return `<span class="chip" style="color:${c.color};background:${rgba(c.color,.12)};border-color:${rgba(c.color,.28)}"><span class="d"></span>${esc(c.label)}</span>`;
}
const stat=(k,v,c)=>`<div class="stat" style="--c:${c}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
 
// ---------- Render: progetti ----------
function renderProjects(){
  const q=($("search").value||"").toLowerCase().trim();
  let list=projects.filter(p=>currentFilter==="all"||p.status===currentFilter);
  if(q) list=list.filter(p=>(p.name+" "+(p.notes||"")).toLowerCase().includes(q));
 
  // ordinamento per colonna
  const RANK={new:0,active:1,paused:2,done:3};
  const keyOf=p=>{
    switch(sortKey){
      case "category": return (catMap[p.category]?.label||p.category||"").toLowerCase();
      case "status":   return RANK[p.status]??99;
      case "created_at":
      case "updated_at": return p[sortKey]||"";
      default:         return (p.name||"").toLowerCase();
    }
  };
  list.sort((a,b)=>{
    const va=keyOf(a), vb=keyOf(b);
    let cmp = va<vb?-1 : va>vb?1 : 0;
    if(cmp===0 && sortKey!=="name"){ // a parità, ordina per nome
      const na=(a.name||"").toLowerCase(), nb=(b.name||"").toLowerCase();
      cmp = na<nb?-1 : na>nb?1 : 0;
    }
    return sortDir==="asc"?cmp:-cmp;
  });
 
  const s={total:projects.length,new:0,active:0,paused:0,done:0};
  projects.forEach(p=>s[p.status]!==undefined&&s[p.status]++);
  $("navProjects").textContent=s.total;
  $("stats").innerHTML=stat("Totale",s.total,"var(--accent)")+stat("Nuovi",s.new,"var(--pink)")+stat("Attivi",s.active,"var(--green)")
    +stat("In pausa",s.paused,"var(--amber)")+stat("Completati",s.done,"var(--slate)");
 
  const tb=$("tbodyP");
  if(!list.length){tb.innerHTML=`<tr><td colspan="7"><div class="empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/></svg>
    <h3>${q||currentFilter!=="all"?"Nessun risultato":"Nessun progetto"}</h3>
    <div>${q||currentFilter!=="all"?"Prova a cambiare filtro o ricerca.":"Aggiungine uno con “Nuovo progetto”."}</div></div></td></tr>`;return;}
  tb.innerHTML=list.map((p,i)=>{
    const cr=fmtDate(p.created_at), up=fmtDate(p.updated_at);
    return `<tr data-id="${p.id}" style="animation-delay:${i*22}ms">
    <td class="name"><span class="id">#${p.id}</span>${esc(p.name)}</td>
    <td>${catChip(p.category)}</td>
    <td><span class="chip st-${p.status}"><span class="d"></span>${ST_LABEL[p.status]||p.status}</span></td>
    <td class="notes"><span title="${esc(p.notes||"")}">${esc(p.notes||"—")}</span></td>
    <td class="date col-date" title="${esc(cr.full)}">${esc(cr.short)}</td>
    <td class="date col-date" title="${esc(up.full)}">${esc(up.short)}</td>
    <td class="actions"><span class="row-actions">
      <button class="btn sm ghost" onclick='openProject(${p.id})' title="Modifica"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
      <button class="btn sm ghost danger" onclick='delProject(${p.id})' title="Elimina"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
    </span></td></tr>`;
  }).join("");
}
 
// ---------- Render: categorie ----------
function renderCategories(){
  $("navCats").textContent=categories.length;
  const tb=$("tbodyC");
  const list = DEMO ? withCounts() : categories;
  if(!list.length){tb.innerHTML=`<tr><td colspan="4"><div class="empty"><h3>Nessuna categoria</h3></div></td></tr>`;return;}
  tb.innerHTML=list.map((c,i)=>`<tr style="animation-delay:${i*22}ms">
    <td class="name"><span style="display:inline-flex;align-items:center;gap:11px">
      <span class="swatch" style="background:${c.color}"></span>${esc(c.label)}</span></td>
    <td class="mono" style="color:var(--txt-3);font-size:12px">${esc(c.key)}</td>
    <td class="num">${c.project_count}</td>
    <td class="actions"><span class="row-actions">
      <button class="btn sm ghost" onclick='openCat(${c.id})' title="Modifica"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
      <button class="btn sm ghost danger" onclick='delCat(${c.id})' title="Elimina"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
    </span></td></tr>`).join("");
}
 
// ---------- Nav / view switch ----------
document.querySelectorAll(".nav-item[data-view]").forEach(n=>n.addEventListener("click",()=>{
  document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));
  n.classList.add("active");
  const v=n.dataset.view;
  $("view-projects").hidden = v!=="projects";
  $("view-categories").hidden = v!=="categories";
  $("view-components").hidden = v!=="components";
  $("view-lists").hidden = v!=="lists";
}));
 
// ---------- Filtri ----------
$("filters").addEventListener("click",e=>{const x=e.target.closest(".filter");if(!x)return;
  $("filters").querySelectorAll(".filter").forEach(y=>y.classList.remove("active"));
  x.classList.add("active");currentFilter=x.dataset.f;renderProjects();});
 
// ---------- Doppio click sulla riga → modifica ----------
$("tbodyP").addEventListener("dblclick",e=>{
  if(e.target.closest(".row-actions")) return;          // ignora i pulsanti azione
  const tr=e.target.closest("tr[data-id]"); if(!tr) return;
  openProject(Number(tr.dataset.id));
});
 
// ---------- Ordinamento per colonna ----------
function setSort(key){
  if(sortKey===key){ sortDir = sortDir==="asc"?"desc":"asc"; }
  else { sortKey=key; sortDir = (key==="created_at"||key==="updated_at")?"desc":"asc"; }
  updateSortHeaders(); renderProjects();
}
function updateSortHeaders(){
  document.querySelectorAll('#view-projects thead th.sortable').forEach(th=>{
    th.classList.remove("sort-asc","sort-desc");
    if(th.dataset.sort===sortKey) th.classList.add(sortDir==="asc"?"sort-asc":"sort-desc");
  });
}
document.querySelector('#view-projects thead').addEventListener("click",e=>{
  const th=e.target.closest("th.sortable"); if(!th) return;
  setSort(th.dataset.sort);
});
updateSortHeaders();
 
// ====================== COMPONENTI ======================
function populateProjectSelects(){
  const opts=projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
  // select del modale
  const sel=f.kProject, cur=sel.value;
  sel.innerHTML=opts||`<option value="" disabled>Nessun progetto — creane uno prima</option>`;
  if(cur && projects.some(p=>String(p.id)===cur)) sel.value=cur;
  // select del filtro
  const fil=$("compProjFilter");
  fil.innerHTML=`<option value="all">Tutti i progetti</option>`+opts;
  fil.value=(compProj==="all"||projects.some(p=>String(p.id)===String(compProj)))?compProj:"all";
  compProj=fil.value;
}
 
function projChip(c){
  const cat=catMap[c.project_category]||{color:"#7b8694"};
  return `<span class="chip" style="color:${cat.color};background:${rgba(cat.color,.12)};border-color:${rgba(cat.color,.28)}"><span class="d"></span>${esc(c.project_name||"—")}</span>`;
}
 
async function refreshShopSummary(){
  try{ shopData = DEMO ? shopSummaryDemo() : await api("/shopping-list/summary"); }
  catch(e){ shopData=[]; }
  // se il negozio attivo non ha più pezzi da comprare, lo deseleziono
  if(activeShop && !shopData.some(s=>s.shop===activeShop)) activeShop=null;
  paintShopCards();
}
function paintShopCards(){
  const box=$("shopSummary");
  if(!shopData.length){ box.innerHTML=`<div class="shophint" style="margin:0">Niente da comprare al momento.</div>`; return; }
  box.innerHTML=shopData.map(s=>`<button class="shopcard ${activeShop===s.shop?'active':''}" data-shop="${esc(s.shop)}">
    <div class="sc-shop"><span class="sc-dot"></span>${esc(s.shop)}</div>
    <div class="sc-meta"><span>${s.items} pezz${s.items===1?'o':'i'}</span><span class="sc-tot">${fmtEur(s.total)}</span></div>
  </button>`).join("");
}
 
function renderComponents(){
  $("navComponents").textContent=components.length;
  const q=($("compSearch").value||"").toLowerCase().trim();
  let list=components.slice();
  if(compFilter!=="all") list=list.filter(c=>c.status===compFilter);
  if(compProj!=="all")   list=list.filter(c=>String(c.project_id)===String(compProj));
  if(activeShop)         list=list.filter(c=>((c.shop&&c.shop.trim())||"—")===activeShop);
  if(q) list=list.filter(c=>(c.name+" "+(c.description||"")+" "+(c.shop||"")+" "+(c.project_name||"")).toLowerCase().includes(q));
  list.sort((a,b)=>(PR_RANK[a.priority]??9)-(PR_RANK[b.priority]??9)||(a.name||"").localeCompare(b.name||""));
 
  const tb=$("tbodyK");
  if(!list.length){ tb.innerHTML=`<tr><td colspan="8"><div class="empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
    <h3>${components.length?"Nessun risultato":"Nessun componente"}</h3>
    <div>${components.length?"Prova a cambiare filtro o ricerca.":"Aggiungine uno con “Nuovo componente”."}</div></div></td></tr>`; return; }
  tb.innerHTML=list.map((c,i)=>{
    const ext=c.url?`<a class="ext" href="${esc(c.url)}" target="_blank" rel="noopener" title="Apri link" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg></a>`:"";
    return `<tr data-id="${c.id}" style="animation-delay:${i*18}ms">
    <td class="name"><span class="id">#${c.id}</span>${esc(c.name)}${ext}${c.description?`<span class="csub">${esc(c.description)}</span>`:""}</td>
    <td>${projChip(c)}</td>
    <td>${esc(c.shop||"—")}</td>
    <td class="qty">${c.quantity??1}</td>
    <td class="price">${fmtEur(c.estimated_price)}</td>
    <td><span class="chip pr-${c.priority}"><span class="d"></span>${PR_LABEL[c.priority]||c.priority}</span></td>
    <td><span class="chip cs-${c.status}"><span class="d"></span>${CS_LABEL[c.status]||c.status}</span></td>
    <td class="actions"><span class="row-actions">
      <button class="btn sm ghost" onclick='openComponent(${c.id})' title="Modifica"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
      <button class="btn sm ghost danger" onclick='delComponent(${c.id})' title="Elimina"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
    </span></td></tr>`;
  }).join("");
}
 
// filtro stato (scoped al proprio contenitore)
$("compFilters").addEventListener("click",e=>{const x=e.target.closest(".filter");if(!x)return;
  $("compFilters").querySelectorAll(".filter").forEach(y=>y.classList.remove("active"));
  x.classList.add("active");compFilter=x.dataset.f;renderComponents();});
function onCompProjFilter(){ compProj=$("compProjFilter").value; renderComponents(); }
 
// click su una scheda negozio della lista spesa → filtra per quel negozio
$("shopSummary").addEventListener("click",e=>{
  const card=e.target.closest(".shopcard"); if(!card) return;
  const shop=card.dataset.shop;
  activeShop=(activeShop===shop)?null:shop;
  if(activeShop){ compFilter="to_buy";
    $("compFilters").querySelectorAll(".filter").forEach(y=>y.classList.toggle("active",y.dataset.f==="to_buy")); }
  paintShopCards(); renderComponents();
});
 
// doppio click sulla riga → modifica
$("tbodyK").addEventListener("dblclick",e=>{
  if(e.target.closest(".row-actions")||e.target.closest("a")) return;
  const tr=e.target.closest("tr[data-id]"); if(!tr) return;
  openComponent(Number(tr.dataset.id));
});
 
function openComponent(id, presetProject){
  populateProjectSelects();
  if(id){const c=components.find(x=>x.id===id);$("kTitle").textContent="Modifica componente";
    f.kId.value=c.id;f.kName.value=c.name;f.kShop.value=c.shop||"";f.kQty.value=c.quantity??1;
    f.kPrice.value=c.estimated_price??"";f.kPriority.value=c.priority||"medium";f.kStatus.value=c.status||"to_buy";
    f.kUrl.value=c.url||"";f.kDesc.value=c.description||"";
    if(projects.some(p=>p.id===c.project_id)) f.kProject.value=String(c.project_id);
  }else{$("kTitle").textContent="Nuovo componente";
    f.kId.value="";f.kName.value="";f.kShop.value="";f.kQty.value=1;f.kPrice.value="";
    f.kPriority.value="medium";f.kStatus.value="to_buy";f.kUrl.value="";f.kDesc.value="";
    if(presetProject) f.kProject.value=String(presetProject);
    else if(compProj!=="all") f.kProject.value=String(compProj);
    else if(projects[0]) f.kProject.value=String(projects[0].id);}
  $("ovK").classList.add("open");setTimeout(()=>f.kName.focus(),120);
}
function closeComponent(){$("ovK").classList.remove("open");}
async function saveComponent(){
  const name=f.kName.value.trim();
  if(!name){toast("Il nome è obbligatorio","err");f.kName.focus();return;}
  if(!f.kProject.value){toast("Crea prima un progetto a cui associare il componente","err");return;}
  const qty=parseInt(f.kQty.value,10);
  const price=f.kPrice.value===""?null:parseFloat(f.kPrice.value);
  const payload={project_id:Number(f.kProject.value),name,
    shop:f.kShop.value.trim()||null,url:f.kUrl.value.trim()||null,
    estimated_price:(price===null||isNaN(price))?null:price,
    quantity:(isNaN(qty)||qty<1)?1:qty,priority:f.kPriority.value,status:f.kStatus.value,
    description:f.kDesc.value.trim()||null};
  const id=f.kId.value,btn=$("kSave");btn.disabled=true;
  try{
    if(id) await api(`/components/${id}`,{method:"PATCH",body:JSON.stringify(payload)});
    else   await api(`/components`,{method:"POST",body:JSON.stringify(payload)});
    await loadAll();closeComponent();toast(id?"Componente aggiornato":"Componente creato","ok");
  }catch(e){toast("Errore: "+e.message,"err");}finally{btn.disabled=false;}
}
async function delComponent(id){
  const c=components.find(x=>x.id===id);
  if(!confirm(`Eliminare il componente “${c.name}”?`))return;
  try{await api(`/components/${id}`,{method:"DELETE"});await loadAll();toast("Componente eliminato","ok");}
  catch(e){toast("Errore: "+e.message,"err");}
}
// --- componenti dentro la scheda progetto ---
function addComponentToProject(){ if(editingProjectId) openComponent(null, editingProjectId); }
function renderProjectComponents(pid){
  const box=$("p-comps"); if(!box) return;
  const list=components.filter(c=>String(c.project_id)===String(pid))
    .sort((a,b)=>(PR_RANK[a.priority]??9)-(PR_RANK[b.priority]??9)||(a.name||"").localeCompare(b.name||""));
  if(!list.length){ box.innerHTML=`<div class="comp-empty">Nessun componente. Aggiungine uno con “Aggiungi”.</div>`; return; }
  box.innerHTML=list.map(c=>`<div class="crow">
    <span class="chip cs-${c.status}" title="${esc(CS_LABEL[c.status]||c.status)}"><span class="d"></span></span>
    <div class="crow-main">
      <span class="crow-name">${esc(c.name)}</span>
      <span class="crow-meta">${c.quantity??1}× · ${fmtEur(c.estimated_price)}${c.shop?` · ${esc(c.shop)}`:""}</span>
    </div>
    <span class="crow-act">
      <button class="btn sm ghost" title="Modifica" onclick="openComponent(${c.id})"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
      <button class="btn sm ghost danger" title="Elimina" onclick="delComponent(${c.id})"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
    </span></div>`).join("");
}
function refreshProjectComponentsPanel(){
  if(editingProjectId && $("ovP").classList.contains("open")) renderProjectComponents(editingProjectId);
}
// ====================== /COMPONENTI ======================
 
// ---------- Select categoria + creazione al volo ----------
function populateCatSelect(keep){
  const sel=f.pCat, cur=keep||sel.value;
  sel.innerHTML=categories.map(c=>`<option value="${c.key}">${esc(c.label)}</option>`).join("")
    +`<option disabled>──────────</option><option value="__new__">+ Nuova categoria…</option>`;
  if(cur && categories.some(c=>c.key===cur)) sel.value=cur;
}
function onCatSelect(){
  const isNew=f.pCat.value==="__new__";
  $("p-newcat").hidden=!isNew;
  if(isNew){ $("p-newcat-name").value=""; setTimeout(()=>$("p-newcat-name").focus(),50); }
}
async function createCatInline(){
  const name=$("p-newcat-name").value.trim();
  if(!name){ toast("Scrivi un nome per la categoria","err"); return; }
  try{
    const cat=await api("/categories",{method:"POST",body:JSON.stringify({label:name})});
    if(!DEMO){ categories=await api("/categories"); } // ricarica con count reali
    rebuildCatMap(); renderCategories();
    populateCatSelect(cat.key); $("p-newcat").hidden=true;
    toast(`Categoria “${cat.label}” creata`,"ok");
  }catch(e){ toast("Errore: "+e.message,"err"); }
}
 
// ---------- Modal Progetto ----------
function openProject(id){
  populateCatSelect();
  $("p-newcat").hidden=true;
  const modal=$("ovP").querySelector(".modal");
  editingProjectId = id || null;
  if(id){const p=projects.find(x=>x.id===id);$("pTitle").textContent="Modifica progetto";
    f.pId.value=p.id;f.pName.value=p.name;f.pStatus.value=p.status;f.pNotes.value=p.notes||"";
    populateCatSelect(p.category);
    modal.classList.add("wide");
    $("p-comps-section").hidden=false;
    renderProjectComponents(id);
  }else{$("pTitle").textContent="Nuovo progetto";
    f.pId.value="";f.pName.value="";f.pStatus.value="new";f.pNotes.value="";
    if(categories[0]) f.pCat.value=categories[0].key;
    modal.classList.remove("wide");
    $("p-comps-section").hidden=true;}
  $("ovP").classList.add("open");setTimeout(()=>f.pName.focus(),120);
}
function closeProject(){$("ovP").classList.remove("open");editingProjectId=null;}
async function saveProject(){
  const name=f.pName.value.trim();
  if(!name){toast("Il nome è obbligatorio","err");f.pName.focus();return;}
  if(f.pCat.value==="__new__"){toast("Crea prima la nuova categoria o scegline una","err");return;}
  const payload={name,category:f.pCat.value,status:f.pStatus.value,notes:f.pNotes.value.trim()||null};
  const id=f.pId.value,btn=$("pSave");btn.disabled=true;
  try{
    if(id) await api(`/projects/${id}`,{method:"PATCH",body:JSON.stringify(payload)});
    else   await api(`/projects`,{method:"POST",body:JSON.stringify(payload)});
    await loadAll();closeProject();toast(id?"Progetto aggiornato":"Progetto creato","ok");
  }catch(e){toast("Errore: "+e.message,"err");}finally{btn.disabled=false;}
}
async function delProject(id){
  const p=projects.find(x=>x.id===id);
  if(!confirm(`Eliminare il progetto “${p.name}”?`))return;
  try{await api(`/projects/${id}`,{method:"DELETE"});await loadAll();toast("Progetto eliminato","ok");}
  catch(e){toast("Errore: "+e.message,"err");}
}
 
// ---------- Modal Categoria ----------
$("cSwatches").innerHTML=PALETTE.map(c=>`<span class="sw" data-c="${c}" style="background:${c}"></span>`).join("");
$("cSwatches").addEventListener("click",e=>{const s=e.target.closest(".sw");if(!s)return;
  f.cColor.value=s.dataset.c;markSwatch();});
function markSwatch(){document.querySelectorAll(".sw").forEach(s=>s.classList.toggle("sel",s.dataset.c.toLowerCase()===f.cColor.value.toLowerCase()));}
f.cColor.addEventListener("input",markSwatch);
 
function openCat(id){
  if(id){const c=categories.find(x=>x.id===id);$("cTitle").textContent="Modifica categoria";
    f.cId.value=c.id;f.cLabel.value=c.label;f.cColor.value=c.color;
  }else{$("cTitle").textContent="Nuova categoria";
    f.cId.value="";f.cLabel.value="";f.cColor.value=PALETTE[categories.length%PALETTE.length];}
  markSwatch();$("ovC").classList.add("open");setTimeout(()=>f.cLabel.focus(),120);
}
function closeCat(){$("ovC").classList.remove("open");}
async function saveCat(){
  const label=f.cLabel.value.trim();
  if(!label){toast("Il nome è obbligatorio","err");f.cLabel.focus();return;}
  const payload={label,color:f.cColor.value};
  const id=f.cId.value,btn=$("cSave");btn.disabled=true;
  try{
    if(id) await api(`/categories/${id}`,{method:"PATCH",body:JSON.stringify(payload)});
    else   await api(`/categories`,{method:"POST",body:JSON.stringify(payload)});
    await loadAll();closeCat();toast(id?"Categoria aggiornata":"Categoria creata","ok");
  }catch(e){toast("Errore: "+e.message,"err");}finally{btn.disabled=false;}
}
async function delCat(id){
  const c=categories.find(x=>x.id===id);
  if(!confirm(`Eliminare la categoria “${c.label}”?`))return;
  try{await api(`/categories/${id}`,{method:"DELETE"});await loadAll();toast("Categoria eliminata","ok");}
  catch(e){toast(e.message,"err");}
}
 
// ---------- Toast / overlay close / esc ----------
function toast(msg,type=""){const el=document.createElement("div");el.className="toast "+type;el.textContent=msg;
  $("toasts").appendChild(el);setTimeout(()=>{el.classList.add("out");setTimeout(()=>el.remove(),250);},2800);}
["ovP","ovC","ovK","ovL","ovI"].forEach(o=>$(o).addEventListener("click",e=>{if(e.target.id===o)$(o).classList.remove("open");}));
document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;
  if(popKey){closePop();return;}
  if($("ovI").classList.contains("open")){closeItem();return;}
  if($("ovL").classList.contains("open")){closeList();return;}
  if($("ovK").classList.contains("open")){closeComponent();return;}
  closeProject();closeCat();});
 
// ====================== LISTE PERSONALIZZATE ======================
function demoSeedLists(){
  lists=[{id:1,name:"Anime",description:"Serie viste e da vedere",item_count:3,
    created_at:"2026-06-10 20:00:00",updated_at:"2026-07-01 21:30:00",
    fields:[
      {id:1,key:"titolo",label:"Titolo",type:"text",options:null,sort_order:0},
      {id:2,key:"anno",label:"Anno",type:"number",options:null,sort_order:1},
      {id:3,key:"episodi",label:"Episodi",type:"number",options:null,sort_order:2},
      {id:4,key:"stato",label:"Stato",type:"select",options:["Da vedere","In corso","Finito"],sort_order:3},
      {id:5,key:"voto",label:"Voto",type:"rating",options:null,sort_order:4},
      {id:6,key:"preferito",label:"Preferito",type:"boolean",options:null,sort_order:5}]}];
  demoItems={1:[
    {id:1,list_id:1,data:{titolo:"Neon Genesis Evangelion",anno:1995,episodi:26,stato:"Finito",voto:9,preferito:true},created_at:"2026-06-10 20:05:00",updated_at:"2026-06-10 20:05:00"},
    {id:2,list_id:1,data:{titolo:"Frieren",anno:2023,episodi:28,stato:"In corso"},created_at:"2026-07-01 21:30:00",updated_at:"2026-07-01 21:30:00"},
    {id:3,list_id:1,data:{titolo:"Cowboy Bebop",anno:1998,episodi:26,stato:"Finito",voto:10,preferito:false},created_at:"2026-06-11 09:00:00",updated_at:"2026-06-11 09:00:00"}]};
}
function demoNow(){return new Date().toISOString().slice(0,19).replace("T"," ");}
function mockLists(path,m,opts){
  const seg=path.split("/").filter(Boolean); // ["lists", id?, "items"|"fields"|..., id?]
  const body=opts.body?JSON.parse(opts.body):{};
  if(path==="/lists/suggest-fields"||/\/items\/suggest$/.test(path)||/\/suggest-fields$/.test(path))
    throw new Error("Funzioni AI non disponibili in modalità demo");
  if(path==="/lists"&&m==="GET") return lists.map(l=>({...l,item_count:(demoItems[l.id]||[]).length}));
  if(path==="/lists"&&m==="POST"){
    const id=Math.max(0,...lists.map(l=>l.id))+1;
    const fields=(body.fields||[]).map((f,i)=>({id:Date.now()+i,key:slug(f.label),label:f.label,type:f.type,
      options:f.options||null,sort_order:i}));
    const l={id,name:body.name,description:body.description||null,fields,item_count:0,
      created_at:demoNow(),updated_at:demoNow()};
    lists.unshift(l);demoItems[id]=[];return l;}
  const lid=parseInt(seg[1]||0), L=lists.find(x=>x.id===lid);
  if(!L) throw new Error("Lista non trovata");
  if(seg.length===2){
    if(m==="PATCH"){Object.assign(L,body);L.updated_at=demoNow();return L;}
    if(m==="DELETE"){lists=lists.filter(x=>x.id!==lid);delete demoItems[lid];return null;}}
  if(seg[2]==="fields"){
    if(seg[3]==="reorder"&&m==="PUT"){
      const ids=body.order||[];
      const cur=L.fields.map(x=>x.id);
      if([...ids].sort().join()!==[...cur].sort().join())
        throw new Error("L'ordine deve contenere tutti e soli gli id dei campi della lista, senza duplicati");
      L.fields=ids.map((id,i)=>{const f=L.fields.find(x=>x.id===id);f.sort_order=i;return f;});
      L.updated_at=demoNow();return L.fields;}
    if(m==="POST"){const f={id:Date.now()+Math.floor(Math.random()*1000),key:slug(body.label),label:body.label,type:body.type,
      options:body.options||null,sort_order:L.fields.length};L.fields.push(f);return f;}
    const fid=parseInt(seg[3]),F=L.fields.find(x=>x.id===fid);
    if(m==="PATCH"){Object.assign(F,body);return F;}
    if(m==="DELETE"){L.fields=L.fields.filter(x=>x.id!==fid);
      (demoItems[lid]||[]).forEach(it=>delete it.data[F.key]);return null;}}
  if(seg[2]==="items"){
    const arr=demoItems[lid]=demoItems[lid]||[];
    if(m==="GET") return [...arr];
    if(m==="POST"){const it={id:Math.max(0,...arr.map(i=>i.id))+1,list_id:lid,data:body.data||{},
      created_at:demoNow(),updated_at:demoNow()};arr.unshift(it);return it;}
    const iid=parseInt(seg[3]),I=arr.find(x=>x.id===iid);
    if(m==="PATCH"){Object.assign(I.data,body.data||{});
      Object.keys(I.data).forEach(k=>{if(I.data[k]===null||I.data[k]==="")delete I.data[k];});
      I.updated_at=demoNow();return I;}
    if(m==="DELETE"){demoItems[lid]=arr.filter(x=>x.id!==iid);return null;}}
  return null;
}

// ---------- render ----------
function activeList(){ return lists.find(l=>l.id===activeListId)||null; }
function renderLists(){
  $("navLists").textContent=lists.length;
  const box=$("listCards");
  if(!lists.length){
    box.innerHTML=`<div class="shophint" style="margin:0">Nessuna lista. Creane una con "Nuova lista".</div>`;
    $("listToolbar").hidden=true;$("listPanel").hidden=true;$("btnEditList").hidden=true;return;
  }
  box.innerHTML=lists.map(l=>`<button class="shopcard ${activeListId===l.id?'active':''}" data-list="${l.id}">
    <div class="sc-shop"><span class="sc-dot"></span>${esc(l.name)}</div>
    <div class="sc-meta"><span>${l.item_count} voc${l.item_count===1?'e':'i'}</span><span class="sc-tot">${l.fields.length} campi</span></div>
  </button>`).join("");
  const has=!!activeList();
  $("listToolbar").hidden=!has;$("listPanel").hidden=!has;$("btnEditList").hidden=!has;
  if(has){ renderFilterBar(); renderItems(); }
}
$("listCards").addEventListener("click",async e=>{
  const card=e.target.closest(".shopcard[data-list]"); if(!card) return;
  const id=Number(card.dataset.list);
  activeListId=(activeListId===id)?null:id;
  if(activeListId){
    try{ listItems=await api(`/lists/${activeListId}/items`); }
    catch(err){ listItems=[]; toast("Errore: "+err.message,"err"); }
  } else listItems=[];
  closePop();
  itemFilters={};
  $("itemSearch").value="";
  renderLists();
});

function fmtVal(f,v){
  if(v===null||v===undefined||v==="") return `<span style="color:var(--txt-3)">—</span>`;
  switch(f.type){
    case "boolean": return v?`<span style="color:var(--green);font-weight:500">✓ Sì</span>`:`<span style="color:var(--txt-3)">✗ No</span>`;
    case "number":  return `<span class="mono" style="color:var(--txt-2)">${Number(v).toLocaleString("it-IT")}</span>`;
    case "rating":  return `<span class="mono">${v}<span style="color:var(--txt-3)">/10</span></span>`;
    case "date":   {const d=new Date(v+"T00:00:00");
      return `<span class="mono" style="font-size:12px;color:var(--txt-2)">${isNaN(d)?esc(String(v)):d.toLocaleDateString("it-IT")}</span>`;}
    case "url":     return `<a class="ext" style="margin:0" href="${esc(v)}" target="_blank" rel="noopener" title="${esc(v)}" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg></a>`;
    case "select":  return `<span class="valchip"><span class="d" style="width:7px;height:7px;border-radius:50%;background:currentColor"></span>${esc(String(v))}</span>`;
    default:        return esc(String(v));
  }
}
// ---------- filtri voci ----------
const FILTERABLE={boolean:1,rating:1,select:1,number:1};
const IC_CHEV=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>`;

function fieldByKey(k){ return (activeList()?.fields||[]).find(x=>x.key===k); }
function textFields(L){ return L.fields.filter(f=>f.type==="text"||f.type==="url"); }
function searchQ(){ return ($("itemSearch").value||"").toLowerCase().trim(); }

// Valori numerici distinti effettivamente presenti nelle voci (es. anni)
function distinctNums(key){
  const s=new Set();
  listItems.forEach(it=>{const v=it.data?.[key]; if(v!==null&&v!==undefined&&v!=="") s.add(Number(v));});
  return [...s].filter(n=>!isNaN(n)).sort((a,b)=>a-b);
}
function numPickMode(key){ return distinctNums(key).length<=NUM_PICK_MAX; }

function fState(f){
  let s=itemFilters[f.key];
  if(!s){
    if(f.type==="boolean")     s={v:"all"};
    else if(f.type==="rating") s={min:null,max:null};
    else if(f.type==="select") s={vals:[]};
    else if(f.type==="number") s={vals:[],min:null,max:null};
    else s={};
    itemFilters[f.key]=s;
  }
  return s;
}
function fActive(f){
  const s=fState(f);
  switch(f.type){
    case "boolean": return s.v!=="all";
    case "rating":  return s.min!=null||s.max!=null;
    case "select":  return s.vals.length>0;
    case "number":  return s.vals.length>0||s.min!=null||s.max!=null;
    default:        return false;
  }
}
function fSummary(f){
  const s=fState(f);
  switch(f.type){
    case "boolean": return s.v==="all"?"Tutti":(s.v==="true"?"Sì":"No");
    case "rating":  return (s.min==null&&s.max==null)?"Tutti":`${s.min??0}–${s.max??10}`;
    case "select":  return s.vals.length?(s.vals.length===1?s.vals[0]:`${s.vals.length} scelte`):"Tutte";
    case "number":
      if(s.vals.length) return s.vals.length===1?String(s.vals[0]):`${s.vals.length} valori`;
      if(s.min!=null||s.max!=null) return `${s.min??"−∞"}–${s.max??"+∞"}`;
      return "Tutti";
    default: return "";
  }
}
function filtersActive(){
  const L=activeList(); if(!L) return false;
  return !!searchQ()||L.fields.some(f=>FILTERABLE[f.type]&&fActive(f));
}
function itemMatches(L,it){
  const d=it.data||{};
  const q=searchQ();
  if(q){
    const hay=textFields(L).map(f=>d[f.key]??"").join(" ").toLowerCase();
    if(!hay.includes(q)) return false;
  }
  for(const f of L.fields){
    if(!FILTERABLE[f.type]||!fActive(f)) continue;
    const s=itemFilters[f.key], v=d[f.key];
    if(f.type==="boolean"){
      if(v!==(s.v==="true")) return false;                 // null/undefined = non impostato → escluso
    }else if(f.type==="rating"){
      if(v==null) return false;
      if(s.min!=null&&v<s.min) return false;
      if(s.max!=null&&v>s.max) return false;
    }else if(f.type==="select"){
      if(!s.vals.includes(v)) return false;
    }else if(f.type==="number"){
      if(v==null||v==="") return false;
      const n=Number(v);
      if(s.vals.length&&!s.vals.includes(n)) return false;
      if(s.min!=null&&n<s.min) return false;
      if(s.max!=null&&n>s.max) return false;
    }
  }
  return true;
}
function renderFilterBar(){
  const L=activeList(); if(!L) return;
  $("searchWrap").hidden=!textFields(L).length;
  $("listFilters").innerHTML=L.fields.filter(f=>FILTERABLE[f.type]).map(f=>
    `<button class="fbtn ${fActive(f)?"on":""}" data-k="${f.key}" onclick="openFilterPop(event,'${f.key}')">
      ${esc(f.label)} <span class="fbv">${esc(fSummary(f))}</span> ${IC_CHEV}
    </button>`).join("");
  $("btnClearFilters").hidden=!filtersActive();
}
function syncFilterBtn(key){
  const f=fieldByKey(key); if(!f) return;
  const btn=$("listFilters").querySelector(`.fbtn[data-k="${key}"]`);
  if(btn){ btn.classList.toggle("on",fActive(f)); btn.querySelector(".fbv").textContent=fSummary(f); }
  $("btnClearFilters").hidden=!filtersActive();
}
function onItemSearch(){ $("btnClearFilters").hidden=!filtersActive(); renderItems(); }
function clearItemFilters(){
  closePop();
  itemFilters={};
  $("itemSearch").value="";
  renderFilterBar(); renderItems();
}

// ---------- popover filtro ----------
function closePop(){ popKey=null; $("pop").hidden=true; $("pop").innerHTML=""; }
function openFilterPop(ev,key){
  ev.stopPropagation();
  if(popKey===key){ closePop(); return; }
  popKey=key;
  const p=$("pop");
  p.hidden=false;
  paintPop();
  const r=ev.currentTarget.getBoundingClientRect();
  const left=Math.max(8,Math.min(r.left,window.innerWidth-p.offsetWidth-12));
  const top=(r.bottom+6+p.offsetHeight>window.innerHeight-8)
    ? Math.max(8,r.top-6-p.offsetHeight) : r.bottom+6;
  p.style.left=left+"px"; p.style.top=top+"px";
}
function paintPop(){
  const f=fieldByKey(popKey); if(!f){ closePop(); return; }
  const s=fState(f), p=$("pop");
  if(f.type==="boolean"){
    p.innerHTML=`<div class="ph">${esc(f.label)}</div>`+
      [["all","Tutti"],["true","Sì"],["false","No"]].map(([v,lab])=>
        `<label><input type="radio" name="pb" value="${v}" ${s.v===v?"checked":""} onchange="setBool('${f.key}','${v}')">${lab}</label>`).join("");
  }else if(f.type==="rating"){
    const opt=(sel)=>Array.from({length:11},(_,n)=>`<option value="${n}" ${sel===n?"selected":""}>${n}</option>`).join("");
    p.innerHTML=`<div class="ph">${esc(f.label)} — intervallo</div>
      <div class="prow"><span>da</span><select onchange="setRating('${f.key}','min',this.value)">
        <option value="">—</option>${opt(s.min)}</select>
        <span>a</span><select onchange="setRating('${f.key}','max',this.value)">
        <option value="">—</option>${opt(s.max)}</select></div>
      <div class="pacts"><button type="button" onclick="resetField('${f.key}')">Azzera</button></div>`;
  }else if(f.type==="select"){
    const opts=f.options||[];
    p.innerHTML=`<div class="ph">${esc(f.label)}</div>`+
      (opts.length?opts.map((o,i)=>
        `<label><input type="checkbox" ${s.vals.includes(o)?"checked":""} onchange="toggleSel('${f.key}',${i})">${esc(o)}</label>`).join("")
        :`<div class="pempty">Nessuna opzione definita.</div>`)+
      `<div class="pacts"><button type="button" onclick="allSel('${f.key}')">Tutte</button>
        <button type="button" onclick="resetField('${f.key}')">Nessuna</button></div>`;
  }else if(f.type==="number"){
    const vals=distinctNums(f.key);
    if(vals.length<=NUM_PICK_MAX){
      p.innerHTML=`<div class="ph">${esc(f.label)} — valori presenti</div>`+
        (vals.length?vals.map(n=>
          `<label><input type="checkbox" ${s.vals.includes(n)?"checked":""} onchange="toggleNum('${f.key}',${n})"><span class="mono">${n}</span></label>`).join("")
          :`<div class="pempty">Nessun valore inserito.</div>`)+
        `<div class="pacts"><button type="button" onclick="resetField('${f.key}')">Azzera</button></div>`;
    }else{
      p.innerHTML=`<div class="ph">${esc(f.label)} — intervallo (${vals.length} valori distinti)</div>
        <div class="prow"><span>da</span><input type="number" step="any" value="${s.min??""}" oninput="setNumRange('${f.key}','min',this.value)">
          <span>a</span><input type="number" step="any" value="${s.max??""}" oninput="setNumRange('${f.key}','max',this.value)"></div>
        <div class="pacts"><button type="button" onclick="resetField('${f.key}')">Azzera</button></div>`;
    }
  }
}
function afterFilterChange(key,repaint){
  syncFilterBtn(key);
  renderItems();
  if(repaint) paintPop();
}
function setBool(key,v){ fState(fieldByKey(key)).v=v; afterFilterChange(key); }
function setRating(key,which,v){ fState(fieldByKey(key))[which]=(v===""?null:parseInt(v,10)); afterFilterChange(key); }
function setNumRange(key,which,v){ fState(fieldByKey(key))[which]=(v===""?null:parseFloat(v)); afterFilterChange(key); }
function toggleSel(key,i){
  const f=fieldByKey(key),s=fState(f),o=(f.options||[])[i];
  s.vals=s.vals.includes(o)?s.vals.filter(x=>x!==o):[...s.vals,o];
  afterFilterChange(key);
}
function allSel(key){ const f=fieldByKey(key); fState(f).vals=[...(f.options||[])]; afterFilterChange(key,true); }
function toggleNum(key,n){
  const s=fState(fieldByKey(key));
  s.vals=s.vals.includes(n)?s.vals.filter(x=>x!==n):[...s.vals,n];
  afterFilterChange(key);
}
function resetField(key){
  const f=fieldByKey(key); delete itemFilters[f.key]; fState(f);
  afterFilterChange(key,true);
}
document.addEventListener("click",e=>{
  if(!popKey) return;
  if(e.target.closest("#pop")) return;
  closePop();
});
window.addEventListener("resize",closePop);
document.querySelector(".content")?.addEventListener("scroll",closePop);

function renderItems(){
  const L=activeList(); if(!L) return;
  $("theadL").innerHTML=`<tr>${L.fields.map(f=>`<th>${esc(f.label)}</th>`).join("")}<th></th></tr>`;
  const list=listItems.filter(it=>itemMatches(L,it));
  $("itemCount").textContent=listItems.length
    ? (list.length===listItems.length?`${listItems.length} voci`:`${list.length} / ${listItems.length}`) : "";
  const tb=$("tbodyL");
  if(!L.fields.length){tb.innerHTML=`<tr><td><div class="empty"><h3>Nessun campo</h3><div>Definisci i campi con "Modifica lista".</div></div></td></tr>`;return;}
  if(!list.length){tb.innerHTML=`<tr><td colspan="${L.fields.length+1}"><div class="empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>
    <h3>${listItems.length?"Nessun risultato":"Lista vuota"}</h3>
    <div>${listItems.length?"Prova a cambiare la ricerca.":"Aggiungi la prima voce con \u201cNuova voce\u201d."}</div></div></td></tr>`;return;}
  tb.innerHTML=list.map((it,i)=>`<tr data-id="${it.id}" style="animation-delay:${i*18}ms">`+
    L.fields.map((f,j)=>j===0
      ?`<td class="name"><span class="id">#${it.id}</span>${fmtVal(f,it.data[f.key])}</td>`
      :`<td>${fmtVal(f,it.data[f.key])}</td>`).join("")+
    `<td class="actions"><span class="row-actions">
      <button class="btn sm ghost" onclick='openItem(${it.id})' title="Modifica"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
      <button class="btn sm ghost danger" onclick='delItem(${it.id})' title="Elimina"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
    </span></td></tr>`).join("");
}
$("tbodyL").addEventListener("dblclick",e=>{
  if(e.target.closest(".row-actions")||e.target.closest("a")) return;
  const tr=e.target.closest("tr[data-id]"); if(!tr) return;
  openItem(Number(tr.dataset.id));
});

// ---------- modale lista ----------
function typeOptions(sel){return Object.entries(FT_LABEL).map(([k,v])=>`<option value="${k}" ${k===sel?"selected":""}>${v}</option>`).join("");}
const IC_GRIP=`<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`;
const IC_UP=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m6 15 6-6 6 6"/></svg>`;
const IC_DOWN=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m6 9 6 6 6-6"/></svg>`;

function paintFieldRows(){
  const box=$("l-fields");
  $("l-fields-empty").hidden=!!draftFields.length;
  const last=draftFields.length-1;
  box.innerHTML=draftFields.map((f,i)=>`<div class="frow" data-i="${i}"
      ondragover="fieldDragOver(event,${i})" ondrop="fieldDrop(event,${i})"
      ondragleave="fieldDragLeave(event)" ondragend="fieldDragEnd(event)">
      <div class="freorder">
        <button type="button" class="fmv" title="Sposta su" ${i===0?"disabled":""} onclick="moveField(${i},${i-1})">${IC_UP}</button>
        <div class="fdrag" title="Trascina per riordinare" draggable="true" ondragstart="fieldDragStart(event,${i})">${IC_GRIP}</div>
        <button type="button" class="fmv" title="Sposta giù" ${i===last?"disabled":""} onclick="moveField(${i},${i+1})">${IC_DOWN}</button>
      </div>
      <div class="finputs">
        <input class="f-label" placeholder="Nome campo" value="${esc(f.label)}" oninput="draftFields[${i}].label=this.value">
        <select class="f-type" onchange="draftFields[${i}].type=this.value;paintFieldRows()">${typeOptions(f.type)}</select>
        <input class="f-opts" ${f.type!=="select"?"data-off":""} placeholder="Opzioni separate da virgola"
          value="${esc((f.options||[]).join(", "))}" oninput="draftFields[${i}]._opts=this.value">
      </div>
      <button class="btn sm ghost danger fdel" title="Rimuovi campo" onclick="removeFieldRow(${i})"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
    </div>`).join("");
}
// Drag & drop: solo maniglia, solo desktop. Su touch il DnD HTML5 non parte:
// lì valgono le frecce ▲▼, che sono il controllo primario sempre visibile.
function fieldDragStart(e,i){
  dragFrom=i; e.dataTransfer.effectAllowed="move";
  try{ e.dataTransfer.setData("text/plain",String(i)); }catch(_){}
  e.target.closest(".frow")?.classList.add("dragging");
}
function fieldDragOver(e,i){
  if(dragFrom===null||dragFrom===i) return;
  e.preventDefault(); e.dataTransfer.dropEffect="move";
  e.currentTarget.classList.remove("over-top","over-bot");
  e.currentTarget.classList.add(i<dragFrom?"over-top":"over-bot");
}
function fieldDragLeave(e){ e.currentTarget.classList.remove("over-top","over-bot"); }
function fieldDrop(e,i){
  e.preventDefault();
  if(dragFrom!==null&&dragFrom!==i) moveField(dragFrom,i);
  dragFrom=null;
}
function fieldDragEnd(){
  dragFrom=null;
  $("l-fields").querySelectorAll(".frow").forEach(r=>r.classList.remove("dragging","over-top","over-bot"));
}
function moveField(from,to){
  if(to<0||to>=draftFields.length||from===to) return;
  const [f]=draftFields.splice(from,1);
  draftFields.splice(to,0,f);
  paintFieldRows();
}
function addFieldRow(preset){
  draftFields.push(Object.assign({id:null,key:null,label:"",type:"text",options:null,_opts:""},preset||{}));
  paintFieldRows();
  if(!preset){const inputs=$("l-fields").querySelectorAll(".f-label");inputs[inputs.length-1]?.focus();}
}
function removeFieldRow(i){
  const f=draftFields[i];
  if(f.id){
    if(!confirm(`Rimuovere il campo \u201c${f.label}\u201d? I valori già inseriti nelle voci verranno eliminati.`)) return;
    draftDeleted.push(f.id);
  }
  draftFields.splice(i,1);
  paintFieldRows();
}
function openList(id){
  draftFields=[];draftDeleted=[];
  if(id){const L=lists.find(x=>x.id===id);$("lTitle").textContent="Modifica lista";
    $("l-id").value=L.id;$("l-name").value=L.name;$("l-desc").value=L.description||"";
    draftFields=L.fields.map(f=>({id:f.id,key:f.key,label:f.label,type:f.type,
      options:f.options?[...f.options]:null,_opts:(f.options||[]).join(", "),
      _orig:{label:f.label,type:f.type,opts:(f.options||[]).join(", ")}}));
    $("lDelete").hidden=false;
  }else{$("lTitle").textContent="Nuova lista";
    $("l-id").value="";$("l-name").value="";$("l-desc").value="";
    $("lDelete").hidden=true;}
  paintFieldRows();
  $("ovL").classList.add("open");setTimeout(()=>$("l-name").focus(),120);
}
function closeList(){$("ovL").classList.remove("open");}
function parseOpts(s){return (s||"").split(",").map(x=>x.trim()).filter(Boolean);}
function collectFields(){
  const out=[];
  for(const f of draftFields){
    const label=(f.label||"").trim();
    if(!label){ if(f.id) throw new Error("Un campo esistente ha il nome vuoto"); continue; }
    const options=f.type==="select"?parseOpts(f._opts):null;
    if(f.type==="select"&&!options.length) throw new Error(`Il campo scelta \u201c${label}\u201d richiede almeno un'opzione`);
    out.push({id:f.id,label,type:f.type,options,_orig:f._orig});
  }
  return out;
}
async function saveList(){
  const name=$("l-name").value.trim();
  if(!name){toast("Il nome è obbligatorio","err");$("l-name").focus();return;}
  let flds;
  try{ flds=collectFields(); }catch(e){ toast(e.message,"err"); return; }
  const id=$("l-id").value,btn=$("lSave");btn.disabled=true;
  const desc=$("l-desc").value.trim()||null;
  try{
    if(!id){
      const L=await api("/lists",{method:"POST",body:JSON.stringify({name,description:desc,
        fields:flds.map(f=>({label:f.label,type:f.type,options:f.options}))})});
      activeListId=L.id; listItems=[];
    }else{
      const lid=Number(id);
      await api(`/lists/${lid}`,{method:"PATCH",body:JSON.stringify({name,description:desc})});
      for(const fid of draftDeleted) await api(`/lists/${lid}/fields/${fid}`,{method:"DELETE"});
      const orderIds=[];
      for(const f of flds){
        if(!f.id){
          const nf=await api(`/lists/${lid}/fields`,{method:"POST",body:JSON.stringify({label:f.label,type:f.type,options:f.options})});
          if(nf&&nf.id) orderIds.push(nf.id);
        }else{
          if(f._orig&&(f._orig.label!==f.label||f._orig.type!==f.type||f._orig.opts!==(f.options||[]).join(", ")))
            await api(`/lists/${lid}/fields/${f.id}`,{method:"PATCH",body:JSON.stringify({label:f.label,type:f.type,options:f.options})});
          orderIds.push(f.id);
        }
      }
      // L'ordine delle righe nell'editor è la fonte di verità: lo scrivo in un colpo solo.
      if(orderIds.length>1) await api(`/lists/${lid}/fields/reorder`,{method:"PUT",body:JSON.stringify({order:orderIds})});
      listItems=await api(`/lists/${lid}/items`);
    }
    itemFilters={};                  // i campi possono essere cambiati: filtri non più validi
    if($("itemSearch")) $("itemSearch").value="";
    await loadAll();closeList();toast(id?"Lista aggiornata":"Lista creata","ok");
  }catch(e){toast("Errore: "+e.message,"err");}finally{btn.disabled=false;}
}
async function delList(){
  const id=Number($("l-id").value); const L=lists.find(x=>x.id===id); if(!L) return;
  if(!confirm(`Eliminare la lista \u201c${L.name}\u201d e tutte le sue ${L.item_count} voci?`)) return;
  try{ await api(`/lists/${id}`,{method:"DELETE"});
    if(activeListId===id){activeListId=null;listItems=[];}
    await loadAll();closeList();toast("Lista eliminata","ok");
  }catch(e){toast("Errore: "+e.message,"err");}
}
async function suggestFields(){
  const name=$("l-name").value.trim();
  if(!name){toast("Scrivi prima il nome della lista: serve all'AI","err");$("l-name").focus();return;}
  const btn=$("lSuggest");btn.disabled=true;const old=btn.innerHTML;
  btn.innerHTML=`<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.5"/></svg> Chiedo a Claude…`;
  try{
    const existing=draftFields.filter(f=>(f.label||"").trim()).map(f=>f.label.trim());
    const r=await api("/lists/suggest-fields",{method:"POST",
      body:JSON.stringify({name,description:$("l-desc").value.trim()||null,existing})});
    (r.fields||[]).forEach(f=>addFieldRow({label:f.label,type:f.type,
      options:f.options||null,_opts:(f.options||[]).join(", ")}));
    toast(`${r.fields.length} campi proposti — modificali o rimuovili prima di salvare`,"ok");
  }catch(e){toast(e.message,"err");}
  finally{btn.disabled=false;btn.innerHTML=old;}
}

// ---------- modale voce ----------
function itemInput(f,v){
  const val=v===null||v===undefined?"":v;
  switch(f.type){
    case "number": return `<input data-key="${f.key}" type="number" step="any" value="${esc(String(val))}">`;
    case "rating": return `<input data-key="${f.key}" type="number" min="0" max="10" step="1" value="${esc(String(val))}" placeholder="0-10">`;
    case "date":   return `<input data-key="${f.key}" type="date" value="${esc(String(val))}">`;
    case "boolean":return `<select data-key="${f.key}"><option value="">—</option><option value="true" ${val===true?"selected":""}>Sì</option><option value="false" ${val===false?"selected":""}>No</option></select>`;
    case "select": return `<select data-key="${f.key}"><option value="">—</option>${(f.options||[]).map(o=>`<option ${String(val)===o?"selected":""}>${esc(o)}</option>`).join("")}</select>`;
    case "url":    return `<input data-key="${f.key}" placeholder="https://…" value="${esc(String(val))}" autocomplete="off">`;
    default:       return `<input data-key="${f.key}" value="${esc(String(val))}" autocomplete="off">`;
  }
}
function openItem(id){
  const L=activeList(); if(!L) return;
  if(!L.fields.length){toast("La lista non ha campi: definiscili con \u201cModifica lista\u201d","err");return;}
  const it=id?listItems.find(x=>x.id===id):null;
  $("iTitle").textContent=it?"Modifica voce":"Nuova voce";
  $("i-id").value=it?it.id:"";
  $("iAiHint").textContent=`L'AI compila i campi vuoti usando \u201c${L.fields[0].label}\u201d come riferimento.`;
  $("i-body").innerHTML=L.fields.map(f=>`<div class="field"><label>${esc(f.label)}${f.type==="rating"?" (0-10)":""}</label>${itemInput(f,it?it.data[f.key]:null)}</div>`).join("");
  $("ovI").classList.add("open");
  setTimeout(()=>$("i-body").querySelector("input,select")?.focus(),120);
}
function closeItem(){$("ovI").classList.remove("open");}
function collectItemData(){
  const L=activeList(),data={};
  L.fields.forEach(f=>{
    const el=$("i-body").querySelector(`[data-key="${f.key}"]`); if(!el) return;
    let v=el.value;
    if(v===""){data[f.key]=null;return;}
    if(f.type==="number") v=parseFloat(v);
    else if(f.type==="rating") v=parseInt(v,10);
    else if(f.type==="boolean") v=(v==="true");
    data[f.key]=v;
  });
  return data;
}
async function saveItem(){
  const L=activeList(); if(!L) return;
  const data=collectItemData();
  if(Object.values(data).every(v=>v===null)){toast("Compila almeno un campo","err");return;}
  const id=$("i-id").value,btn=$("iSave");btn.disabled=true;
  try{
    if(id) await api(`/lists/${L.id}/items/${id}`,{method:"PATCH",body:JSON.stringify({data})});
    else   await api(`/lists/${L.id}/items`,{method:"POST",body:JSON.stringify({data})});
    listItems=await api(`/lists/${L.id}/items`);
    lists=await api("/lists");
    renderLists();closeItem();toast(id?"Voce aggiornata":"Voce creata","ok");
  }catch(e){toast("Errore: "+e.message,"err");}finally{btn.disabled=false;}
}
async function delItem(id){
  const L=activeList(); if(!L) return;
  if(!confirm("Eliminare questa voce?")) return;
  try{ await api(`/lists/${L.id}/items/${id}`,{method:"DELETE"});
    listItems=await api(`/lists/${L.id}/items`); lists=await api("/lists");
    renderLists();toast("Voce eliminata","ok");
  }catch(e){toast("Errore: "+e.message,"err");}
}
async function suggestItem(){
  const L=activeList(); if(!L) return;
  const first=L.fields[0];
  const el=$("i-body").querySelector(`[data-key="${first.key}"]`);
  const hint=(el?.value||"").trim();
  if(!hint){toast(`Compila prima \u201c${first.label}\u201d: serve all'AI come riferimento`,"err");el?.focus();return;}
  const btn=$("iSuggest");btn.disabled=true;const old=btn.innerHTML;
  btn.innerHTML=`<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.5"/></svg> Chiedo a Claude…`;
  try{
    const r=await api(`/lists/${L.id}/items/suggest`,{method:"POST",body:JSON.stringify({hint})});
    let filled=0;
    Object.entries(r.data||{}).forEach(([k,v])=>{
      const inp=$("i-body").querySelector(`[data-key="${k}"]`);
      if(!inp||v===null||v===undefined) return;
      if(inp.value!==""&&inp.value!==null) return;      // non sovrascrive l'input dell'utente
      inp.value=(typeof v==="boolean")?String(v):v; filled++;
    });
    toast(filled?`${filled} campi proposti dall'AI — verifica i valori prima di salvare`:"L'AI non ha trovato valori affidabili","ok");
  }catch(e){toast(e.message,"err");}
  finally{btn.disabled=false;btn.innerHTML=old;}
}
// ====================== /LISTE ======================
 
// ---------- Boot ----------
(async()=>{ await checkConn(); if(!DEMO){ await loadAll(); } else { rebuildCatMap(); renderAll(); } })();
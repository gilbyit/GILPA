// GILPA — core: config, stato condiviso, helper, API/mock, connessione, load, nav, toast

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
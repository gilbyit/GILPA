// GILPA — dominio Componenti: lista spesa, render, modale, pannello progetto

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
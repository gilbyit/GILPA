// GILPA — dominio Progetti: render, filtri, ordinamento, modale, CRUD

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
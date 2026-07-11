// GILPA — dominio Categorie: render, select, modale, CRUD

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
// GILPA — boot

// ---------- Boot ----------
(async()=>{ await checkConn(); if(!DEMO){ await loadAll(); } else { rebuildCatMap(); renderAll(); } })();
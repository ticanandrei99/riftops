let seriesRows=[];
const seriesNote=message=>{$('#series-note').textContent=message;};
async function seriesRequest(url,method='GET',body){
  const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
  const d=await r.json();if(!r.ok)throw Error((d.error||'Operația nu a reușit.')+(d.requestId?' · Request ID: '+d.requestId:''));return d;
}
function seriesScore(item,side){return item.games.filter(g=>g.winner===side).length;}
async function loadSeries(){
  if(!canStaff()){seriesRows=[];$('#series-list').replaceChildren();return;}
  try{
    const d=await seriesRequest('/api/admin/series');seriesRows=d.series;
    $('#series-list').innerHTML=seriesRows.length?seriesRows.map(item=>{
      const blue=seriesScore(item,'blue'),red=seriesScore(item,'red'),done=Math.max(blue,red)>=Math.floor(item.bestOf/2)+1;
      return `<div class="series-card" data-series-id="${esc(item.id)}"><div class="section-kicker">BO${item.bestOf} · ${done?'FINALIZAT':'ÎN DESFĂȘURARE'}</div><div class="series-score"><b>${esc(item.blue)}</b><strong>${blue} : ${red}</strong><b>${esc(item.red)}</b></div><div class="series-games">${item.games.map((g,i)=>`G${i+1}: ${esc(item[g.winner])}`).join(' · ')||'Niciun meci confirmat.'}</div><div class="admin-actions"><button class="btn btn-ghost" data-series-action="obs">LINK OBS</button>${done?'':`<button class="btn btn-secondary" data-series-action="blue">BLUE WIN</button><button class="btn btn-secondary" data-series-action="red">RED WIN</button>`}${item.games.length?'<button class="btn btn-ghost" data-series-action="undo">ANULEAZĂ ULTIMUL REZULTAT</button>':''}<button class="btn btn-danger" data-series-action="delete">ȘTERGE</button></div></div>`;
    }).join(''):'<p class="subtle">Creează prima serie pentru următorul meci.</p>';
  }catch(e){seriesNote(e.message);}
}
$('#series-create').addEventListener('click',async()=>{
  const btn=$('#series-create');btn.disabled=true;
  try{await seriesRequest('/api/admin/series','POST',{blue:$('#series-blue').value,red:$('#series-red').value,bestOf:Number($('#series-format').value)});seriesNote('✓ Serie creată.');await loadSeries();}catch(e){seriesNote(e.message);}finally{btn.disabled=false;}
});
$('#series-refresh').addEventListener('click',loadSeries);
$('#nav').addEventListener('click',e=>{if(e.target.closest('[data-tab="series"]'))loadSeries();});
$('#series-import').addEventListener('click',()=>{
  const teams=currentTeams?.matches?.[0]?.teams||currentTeams?.teams;
  if(!teams?.[0]||!teams?.[1]){seriesNote('Generează mai întâi un Draft.');return;}
  $('#series-blue').value=teams[0].name;$('#series-red').value=teams[1].name;seriesNote('✓ Primele două echipe din Draft sunt pregătite.');
});
$('#series-list').addEventListener('click',async e=>{
  const btn=e.target.closest('[data-series-action]');if(!btn||!canStaff())return;
  const item=seriesRows.find(x=>x.id===btn.closest('[data-series-id]').dataset.seriesId);if(!item)return;
  const action=btn.dataset.seriesAction;
  if(action==='obs'){const url=new URL('/overlay.html',location.href);url.searchParams.set('series',item.id);try{await navigator.clipboard.writeText(url.href);seriesNote('✓ Link OBS copiat. Adaugă-l ca Browser Source.');}catch{prompt('Link OBS — copiază în Browser Source:',url.href);}return;}
  if(!confirm(action==='delete'?'Ștergi această serie?':action==='undo'?'Anulezi ultimul rezultat?':`Confirmi victoria ${item[action]}?`))return;
  const controls=[...btn.closest('[data-series-id]').querySelectorAll('button')];controls.forEach(b=>b.disabled=true);
  try{await seriesRequest(`/api/admin/series/${item.id}${action==='delete'?'':action==='undo'?'/games/last':'/games'}`,['delete','undo'].includes(action)?'DELETE':'POST',{revision:item.revision,winner:action});seriesNote('✓ Salvat.');}catch(err){seriesNote(err.message);}finally{controls.forEach(b=>b.disabled=false);await loadSeries();}
});
$('#series-export').addEventListener('click',()=>{
  if(!canStaff())return;
  // Prevent spreadsheet formula execution when a team name begins with a formula marker.
  const cell=value=>'"'+String(/^[\s]*[=+\-@]/.test(String(value))?"'"+value:value).replaceAll('"','""')+'"';
  const csv=[['Blue','Red','Format','Blue wins','Red wins','Created at'],...seriesRows.map(i=>[i.blue,i.red,`BO${i.bestOf}`,seriesScore(i,'blue'),seriesScore(i,'red'),i.createdAt])].map(r=>r.map(cell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='riftops-series.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

import crypto from 'node:crypto';

// A series is independent of bracket progression: staff confirm each game manually.
export function registerSeries(app,{requireStaff,read,write,audit}) {
  const list=()=>read();
  const conflict=(res)=>res.status(409).json({error:'Seria a fost modificată. Reîncarcă înainte de a confirma.'});
  app.get('/api/admin/series',requireStaff,(_req,res)=>res.json({success:true,series:list()}));
  app.post('/api/admin/series',requireStaff,(req,res)=>{
    const b=req.body||{},names=[b.blue,b.red].map(x=>typeof x==='string'?x.trim():'');
    if(names.some(x=>x.length<1||x.length>64)||names[0].toLowerCase()===names[1].toLowerCase()||![1,3,5].includes(b.bestOf))return res.status(400).json({error:'Alege două echipe distincte și BO1, BO3 sau BO5.'});
    const rows=list();if(rows.length>=100)return res.status(409).json({error:'Limita este de 100 de serii. Șterge o serie veche.'});
    const item={id:crypto.randomUUID(),blue:names[0],red:names[1],bestOf:b.bestOf,games:[],revision:0,createdAt:new Date().toISOString(),createdBy:req.user.name};
    rows.unshift(item);write(rows);audit('series.create',req,{id:item.id});res.status(201).json({success:true,item});
  });
  app.post('/api/admin/series/:id/games',requireStaff,(req,res)=>{
    const rows=list(),item=rows.find(x=>x.id===req.params.id);if(!item)return res.status(404).json({error:'Seria nu există.'});
    const b=req.body||{};if(b.revision!==item.revision)return conflict(res);
    if(!['blue','red'].includes(b.winner))return res.status(400).json({error:'Câștigător invalid.'});
    const wins=side=>item.games.filter(g=>g.winner===side).length;
    if(Math.max(wins('blue'),wins('red'))>=Math.floor(item.bestOf/2)+1)return res.status(409).json({error:'Seria este deja încheiată.'});
    item.games.push({winner:b.winner,time:new Date().toISOString(),by:req.user.name});item.revision++;write(rows);audit('series.game_confirm',req,{id:item.id,winner:b.winner});res.json({success:true,item});
  });
  app.delete('/api/admin/series/:id/games/last',requireStaff,(req,res)=>{
    const rows=list(),item=rows.find(x=>x.id===req.params.id);if(!item)return res.status(404).json({error:'Seria nu există.'});
    if(req.body?.revision!==item.revision)return conflict(res);
    if(!item.games.length)return res.status(409).json({error:'Nu există rezultat de anulat.'});
    item.games.pop();item.revision++;write(rows);audit('series.game_undo',req,{id:item.id});res.json({success:true,item});
  });
  app.delete('/api/admin/series/:id',requireStaff,(req,res)=>{
    const rows=list(),item=rows.find(x=>x.id===req.params.id);if(!item)return res.status(404).json({error:'Seria nu există.'});
    if(req.body?.revision!==item.revision)return conflict(res);
    write(rows.filter(x=>x.id!==item.id));audit('series.delete',req,{id:item.id});res.json({success:true});
  });
}

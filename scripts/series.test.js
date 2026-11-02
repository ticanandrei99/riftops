import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';

test('Series workflow, persistence, CSRF and staff permission boundaries',async()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const testRoot=path.join(root,'.test-runs');fs.mkdirSync(testRoot,{recursive:true});
  const dir=fs.mkdtempSync(path.join(testRoot,'run-'));
  const account=(id,role)=>{const salt=crypto.randomBytes(16).toString('hex');return {id,name:id,role,active:true,salt,hash:crypto.scryptSync('test-only-'+id,salt,64).toString('hex')};};
  fs.writeFileSync(path.join(dir,'auth.json'),JSON.stringify({users:[account('admin','admin'),account('tech','technician')]}));
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  let child;
  async function start(){
    child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),RIFT_DATA_DIR:dir,NODE_ENV:'development',RIOT_API_KEY:'',DATABASE_URL:''},stdio:'ignore'});
    for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/auth/status`)).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Server failed to start');
  }
  async function stop(){if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}}
  async function request(url,method='GET',body,session,csrf=true){
    const headers={};if(body!==undefined)headers['Content-Type']='application/json';if(session){headers.Cookie=session.cookie;if(csrf)headers['X-CSRF-Token']=session.csrf;}
    const res=await fetch(`http://127.0.0.1:${port}${url}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')};
  }
  async function login(id){const r=await request('/api/auth/login','POST',{password:'test-only-'+id});assert.equal(r.status,200);assert.match(r.cookie,/HttpOnly; SameSite=Strict/);const session={cookie:r.cookie.split(';')[0]};session.csrf=(await request('/api/auth/status','GET',undefined,session)).body.csrfToken;return session;}
  try{
    await start();
    assert.equal((await request('/api/admin/series')).status,401);
    const admin=await login('admin'),tech=await login('tech');
    assert.equal((await request('/api/admin/series','POST',{blue:'A',red:'B',bestOf:3},admin,false)).status,403);
    assert.equal((await request('/api/admin/access','POST',{name:'Escalation',role:'technician'},admin)).status,403);
    assert.equal((await request('/api/admin/access/tech/reset-password','POST',{},admin)).status,403);
    assert.equal((await request('/api/tech/logs','GET',undefined,admin)).status,403);
    assert.equal((await request('/api/admin/series','POST',{blue:'A',red:'a',bestOf:3},admin)).status,400);
    assert.equal((await request('/api/admin/series','POST',{blue:'A',red:'B',bestOf:2},admin)).status,400);
    const bracket=[{name:'FINAL',matches:[{teams:[{name:'Blue'},{name:'Red'}],winner:null}]}];
    assert.equal((await request('/api/admin/workflow/snapshots','POST',{label:'Empty'},admin)).status,400);
    assert.equal((await request('/api/admin/workflow/snapshots','POST',{bracket},undefined)).status,401);
    const snap=await request('/api/admin/workflow/snapshots','POST',{label:'Bracket QA',bracket},admin);assert.equal(snap.status,200);
    assert.deepEqual((await request('/api/admin/workflow/snapshots','GET',undefined,admin)).body.snapshots[0].bracket,bracket);
    assert.equal((await request('/api/admin/workflow/snapshots/'+snap.body.snapshot.id+'/restore','POST',{},admin)).status,200);
    assert.deepEqual((await request('/api/admin/workflow','GET',undefined,admin)).body.workflow.bracket,bracket);
    const created=await request('/api/admin/series','POST',{blue:'A',red:'B',bestOf:3},admin);assert.equal(created.status,201);const id=created.body.item.id;
    const game=revision=>request(`/api/admin/series/${id}/games`,'POST',{revision,winner:'blue'},admin);
    const simultaneous=await Promise.all([game(0),game(0)]);assert.deepEqual(simultaneous.map(x=>x.status).sort(),[200,409]);
    assert.equal((await game(1)).status,200);
    const publicScore=await request(`/api/overlay/state?series=${id}`);
    assert.equal(publicScore.status,200);assert.equal(publicScore.body.state.series.blueWins,2);
    assert.equal(publicScore.body.state.series.createdBy,undefined);
    assert.equal((await game(2)).status,409);
    assert.equal((await request(`/api/admin/series/${id}/games/last`,'DELETE',{revision:2},tech)).status,200);
    await stop();await start();
    assert.ok((await request("/api/admin/workflow/snapshots","GET",undefined,admin)).body.snapshots.some(x=>x.id===snap.body.snapshot.id));
    let item=(await request('/api/admin/series','GET',undefined,admin)).body.series[0];assert.equal(item.games.length,1);assert.equal(item.revision,3);
    assert.equal((await request('/api/tech/maintenance','POST',{enabled:true},tech)).body.code,'REAUTH_REQUIRED');
    assert.equal((await request('/api/auth/reauth','POST',{password:'wrong-password'},tech)).status,401);
    assert.equal((await request('/api/auth/reauth','POST',{password:'test-only-tech'},tech)).status,200);
    const granted=await request('/api/admin/access','POST',{name:'New Staff',role:'admin'},tech);assert.equal(granted.status,201);assert.ok(granted.body.temporaryPassword);
    assert.equal((await request('/api/tech/integrity','GET',undefined,tech)).body.healthy,true);
    // Force a handler failure to verify actionable, technician-only diagnostics.
    const seriesPath=path.join(dir,'series.json'),before=fs.readFileSync(seriesPath);
    fs.writeFileSync(seriesPath,'{}');
    const failure=await request('/api/admin/series','POST',{blue:'X',red:'Y',bestOf:3},tech);assert.equal(failure.status,500);assert.ok(failure.body.requestId);
    fs.writeFileSync(seriesPath,before);
    assert.equal((await request('/api/tech/errors','GET',undefined,admin)).status,403);
    const errors=(await request('/api/tech/errors','GET',undefined,tech)).body.errors;
    assert.ok(errors.some(x=>x.requestId===failure.body.requestId&&x.method==='POST'&&x.status===500));
    assert.equal((await request('/api/tech/errors/resolve','POST',{id:errors[0].id},tech)).status,200);
    assert.equal((await request('/api/tech/errors','GET',undefined,tech)).body.errors.find(x=>x.id===errors[0].id).resolved,true);
    assert.equal((await request('/api/admin/access/tech','PATCH',{role:'admin'},tech)).status,400);
    assert.equal((await request('/api/admin/access/admin/reset-password','POST',{},tech)).status,200);
    assert.equal((await request('/api/admin/series','GET',undefined,admin)).status,401);
    assert.equal((await request('/api/auth/logout','POST',{},tech)).status,200);
    assert.equal((await request('/api/admin/series','GET',undefined,tech)).status,401);
    const fresh=await login('tech');
    const sessionsPath=path.join(dir,'sessions.json'),sessions=JSON.parse(fs.readFileSync(sessionsPath));for(const v of Object.values(sessions))v.lastSeenAt=Date.now()-31*60000;fs.writeFileSync(sessionsPath,JSON.stringify(sessions));
    assert.equal((await request('/api/admin/series','GET',undefined,fresh)).status,401);
    const audit=fs.readFileSync(path.join(dir,'audit.ndjson'),'utf8');assert.match(audit,/series.game_undo/);assert.ok(!audit.includes('test-only-'));
  }catch(error){if(fs.existsSync(path.join(dir,'tech-logs.ndjson')))console.error(fs.readFileSync(path.join(dir,'tech-logs.ndjson'),'utf8'));throw error;}finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
});

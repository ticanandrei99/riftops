import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
dotenv.config({path:path.join(root,'.env'),quiet:true});
dotenv.config({path:path.join(root,'.env.local'),quiet:true});

test('Neon E2E: database, login, CSRF, series, concurrent writers and restart persistence',{skip:!process.env.DATABASE_URL,timeout:120000},async()=>{
  const namespace='e2e-'+crypto.randomUUID();
  const testUrl=new URL(process.env.DATABASE_URL);testUrl.searchParams.set('sslmode','verify-full');
  const pool=new pg.Pool({connectionString:testUrl.href,max:2});
  const dataDir=path.join(root,'.test-runs',namespace);fs.mkdirSync(dataDir,{recursive:true});
  const salt=crypto.randomBytes(16).toString('hex'),password=crypto.randomBytes(32).toString('base64url');
  const auth={version:2,users:[{id:'test-admin',name:'Test Admin',role:'admin',active:true,salt,hash:crypto.scryptSync(password,salt,64).toString('hex')}]};
  const baseline={name:'Neon verification',status:'SETUP',players:{}};
  const baseEnv={...process.env,RIFT_DB_NAMESPACE:namespace,RIFT_DATA_DIR:dataDir,NODE_ENV:'development'};
  let processes=[];
  async function start(){
    const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
    const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...baseEnv,PORT:String(port)},stdio:'ignore'});processes.push(child);
    const base=`http://127.0.0.1:${port}`;
    for(let i=0;i<120;i++){try{if((await fetch(base+'/api/auth/status')).ok)return {child,base};}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Test server startup failed');
  }
  async function stop(child){if(child.exitCode===null&&!child.killed){const exited=once(child,'exit');child.kill();await exited;}}
  let session={};
  async function call(server,url,method='GET',body,staff=true){const headers=body?{'Content-Type':'application/json'}:{};if(staff&&session.cookie){headers.Cookie=session.cookie;headers['X-CSRF-Token']=session.csrf;}const r=await fetch(server.base+url,{method,headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};}
  try{
    // Only insert fixtures into a unique, disposable namespace.
    for(const [key,value] of Object.entries({'auth.json':auth,'community.json':baseline}))await pool.query('INSERT INTO rift_documents(namespace,key,contents) VALUES($1,$2,$3)',[namespace,key,JSON.stringify(value)]);
    let server=await start();
    assert.equal((await call(server,'/api/admin/series','GET',undefined,false)).status,401);
    const login=await call(server,'/api/auth/login','POST',{password},false);assert.equal(login.status,200);session.cookie=login.cookie.split(';')[0];session.csrf=(await call(server,'/api/auth/status')).body.csrfToken;
    const created=await call(server,'/api/admin/series','POST',{blue:'Neon Blue',red:'Neon Red',bestOf:3});assert.equal(created.status,201);const id=created.body.item.id;
    const other=await start();
    const wins=await Promise.all([server,other].map(s=>call(s,`/api/admin/series/${id}/games`,'POST',{winner:'blue',revision:0})));
    assert.deepEqual(wins.map(r=>r.status).sort(),[200,409]);
    assert.equal((await call(server,'/api/community/ready','POST',{name:'Test Player',ready:true},false)).status,200);
    const dbRows=await pool.query('SELECT key,contents FROM rift_documents WHERE namespace=$1',[namespace]);
    const documents=Object.fromEntries(dbRows.rows.map(r=>[r.key,r.contents]));
    assert.equal(JSON.parse(documents['series.json'])[0].games.length,1);
    assert.equal(JSON.parse(documents['community.json']).players['test player'].ready,true);
    assert.ok(JSON.parse(documents['sessions.json']));assert.match(documents['audit.ndjson'],/series.game_confirm/);
    assert.equal(fs.existsSync(path.join(dataDir,'series.json')),false,'Postgres mode must not save series to local disk');
    await stop(server.child);await stop(other.child);server=await start();
    assert.equal((await call(server,'/api/admin/series')).body.series[0].games.length,1);
    assert.equal((await call(server,`/api/overlay/state?series=${id}`,'GET',undefined,false)).body.state.series.blueWins,1);
    assert.equal((await call(server,'/api/auth/logout','POST',{})).status,200);
    assert.equal((await call(server,'/api/admin/series')).status,401);
    console.log('Verified against Neon: saved scores + ready check + sessions + audit; two servers; restart; no local data writes.');
  }finally{
    for(const child of processes)await stop(child);
    assert.ok(namespace.startsWith('e2e-'));
    await pool.query('DELETE FROM rift_documents WHERE namespace=$1',[namespace]);await pool.end();
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
});

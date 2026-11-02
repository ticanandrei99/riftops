import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

test('Series UI confirms blue/red results, renders persisted score, and reports failed saves',async()=>{
 const elements=new Map();
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',handlers:{},addEventListener(type,fn){this.handlers[type]=fn},replaceChildren(){this.innerHTML=''}});return elements.get(id)};
 const item={id:'s',blue:'Blue',red:'Red',bestOf:5,games:[],revision:0};let fail=false;
 const ctx=vm.createContext({$:el,canStaff:()=>true,esc:String,confirm:()=>true,currentTeams:null,URL,Blob,setTimeout,location:{href:'http://local/',origin:'http://local'},navigator:{},document:{},fetch:async(url,options)=>{
  if(options.method==='POST'){
   if(fail)return {ok:false,json:async()=>({error:'Unavailable',requestId:'trace-1'})};
   const b=JSON.parse(options.body);assert.equal(b.revision,item.revision);item.games.push({winner:b.winner});item.revision++;
  }
  return {ok:true,json:async()=>({series:[structuredClone(item)],item})};
 }});
 vm.runInContext(fs.readFileSync('public/series-ui.js','utf8'),ctx);await vm.runInContext('loadSeries()',ctx);
 async function click(action){const button={dataset:{seriesAction:action},disabled:false,closest:()=>({dataset:{seriesId:'s'},querySelectorAll:()=>[button]})};await el('#series-list').handlers.click({target:{closest:()=>button}});assert.equal(button.disabled,false)}
 await click('blue');assert.match(el('#series-list').innerHTML,/1 : 0/);
 await click('red');assert.match(el('#series-list').innerHTML,/1 : 1/);
 fail=true;await click('blue');assert.match(el('#series-list').innerHTML,/1 : 1/);assert.match(el('#series-note').textContent,/trace-1/);
});

test('Reauthentication retries the original action only after success and exposes wrong-password errors',async()=>{
 const source=fs.readFileSync('public/app.js','utf8').split('const $ =')[0];
 for(const accepted of [true,false]){
  let attempts=0;const calls=[];
  const ctx=vm.createContext({URL,Headers,Request,location:{href:'http://local/',origin:'http://local'},prompt:()=> 'test-password',window:{fetch:async(url,options={})=>{
   calls.push({url,options});
   if(url==='/api/auth/status')return new Response(JSON.stringify({csrfToken:'csrf'}));
   if(url==='/api/auth/reauth'){assert.equal(options.headers.get('X-CSRF-Token'),'csrf');return new Response(JSON.stringify({error:'Invalid access password.'}),{status:accepted?200:401})}
   return ++attempts===1?new Response(JSON.stringify({code:'REAUTH_REQUIRED'}),{status:403}):new Response('{}');
  }}});
  vm.runInContext(source,ctx);ctx.inputDialog=async()=> 'test-password';const result=await vm.runInContext("window.fetch('/api/admin/access',{method:'POST',body:'{}'})",ctx);
  assert.equal(result.status,accepted?200:401);assert.equal(attempts,accepted?2:1);
 }
});

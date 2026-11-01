import nativeFs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const root=path.dirname(fileURLToPath(import.meta.url));
dotenv.config({path:path.join(root,'.env'),quiet:true});
dotenv.config({path:path.join(root,'.env.local'),quiet:true});
const dataDir=process.env.RIFT_DATA_DIR?path.resolve(process.env.RIFT_DATA_DIR):path.join(root,'.data');
const namespace=process.env.RIFT_DB_NAMESPACE||'riftops';
const context=new AsyncLocalStorage();
function verifiedUrl(value){const url=new URL(value);url.searchParams.set('sslmode','verify-full');return url.href;}
if(process.env.NODE_ENV==='production'&&!process.env.DATABASE_URL)throw Error('DATABASE_URL is required in production.');
const pool=process.env.DATABASE_URL?new pg.Pool({connectionString:verifiedUrl(process.env.DATABASE_URL),max:5,connectionTimeoutMillis:15000,idleTimeoutMillis:30000}):null;
pool?.on('error',()=>console.error('Postgres connection interrupted.'));
let initial=new Map(),pending=Promise.resolve();
const key=file=>{const relative=path.relative(dataDir,path.resolve(String(file)));return relative && !relative.startsWith('..')&&!path.isAbsolute(relative)?relative.split(path.sep).join('/'):null;};
const snapshot=()=>context.getStore()?.files||initial;

export const storage={
  enabled:Boolean(pool),namespace,dataDir,
  async ping(){if(pool)await pool.query("SELECT 1");},
  async initialize(){
    if(!pool)return;
    // This additive schema is also tracked in migrations/001-document-store.sql.
    const migration=new pg.Client({connectionString:verifiedUrl(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL),connectionTimeoutMillis:15000});
    try{await migration.connect();await migration.query(nativeFs.readFileSync(path.join(root,'migrations','001-document-store.sql'),'utf8'));}finally{await migration.end();}
    initial=new Map((await pool.query('SELECT key, contents FROM rift_documents WHERE namespace=$1',[namespace])).rows.map(r=>[r.key,r.contents]));
  },
  async transaction(fn){
    if(!pool)return fn();
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '15s'");
      // One state-changing operation at a time, including across server instances.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[namespace]);
      const files=new Map((await client.query('SELECT key,contents FROM rift_documents WHERE namespace=$1',[namespace])).rows.map(r=>[r.key,r.contents]));
      const scope={files,dirty:new Set(),deleted:new Set(),closed:false};
      return await context.run(scope,async()=>{
        try{
          const result=await fn();
          if(result?.storageRollback)throw Error('Request failed; transaction rolled back.');
          for(const k of scope.dirty)await client.query('INSERT INTO rift_documents(namespace,key,contents) VALUES($1,$2,$3) ON CONFLICT(namespace,key) DO UPDATE SET contents=EXCLUDED.contents,updated_at=now()',[namespace,k,files.get(k)]);
          for(const k of scope.deleted)await client.query('DELETE FROM rift_documents WHERE namespace=$1 AND key=$2',[namespace,k]);
          await client.query('COMMIT');scope.closed=true;initial=new Map(files);return result;
        }catch(error){scope.closed=true;throw error;}
      });
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  },
  middleware(req,res,next){
    if(!pool || !req.path.startsWith('/api/'))return next();
    const end=res.end.bind(res);let sent=false;
    storage.transaction(()=>new Promise((resolve,reject)=>{
      const abort=()=>{if(!sent)reject(Error('Client disconnected'));};res.once('close',abort);
      res.end=(chunk,encoding,callback)=>{
        if(sent)return res;sent=true;res.removeListener('close',abort);
        resolve({chunk,encoding,callback,storageRollback:res.statusCode>=500});return res;
      };
      next();
    })).then(({chunk,encoding,callback})=>end(chunk,encoding,callback)).catch(()=>{
      res.end=end;if(res.destroyed)return;
      res.removeHeader('Content-Length');res.statusCode=503;res.setHeader('Content-Type','application/json');
      end(JSON.stringify({error:'Data storage unavailable. Please retry.',requestId:req.requestId}));
    });
  },
  async close(){await pending;await pool?.end();},
  async importLocal(){
    if(!pool)throw Error('DATABASE_URL is not configured.');
    return storage.transaction(()=>{
      const scope=context.getStore();if(scope.files.size)throw Error('Database already contains application data. Import cancelled.');
      let count=0;
      if(nativeFs.existsSync(dataDir))for(const entry of nativeFs.readdirSync(dataDir,{withFileTypes:true})){
        if(!entry.isFile()||!(/\.(json|ndjson)$/.test(entry.name)))continue;
        const text=nativeFs.readFileSync(path.join(dataDir,entry.name),'utf8');
        if(entry.name.endsWith('.json'))JSON.parse(text);
        scope.files.set(entry.name,text);scope.dirty.add(entry.name);count++;
      }
      return count;
    });
  }
};

function mutate(fn){
  const scope=context.getStore();
  if(scope&&!scope.closed)return fn(scope);
  // Startup/shutdown telemetry runs outside an HTTP request.
  pending=pending.then(()=>storage.transaction(()=>fn(context.getStore()))).catch(()=>console.error('Background database write failed.'));
}
const api={...nativeFs};
api.mkdirSync=(file,options)=>pool&&(path.resolve(String(file))===dataDir||key(file))?undefined:nativeFs.mkdirSync(file,options);
api.existsSync=file=>{const k=key(file);return pool&&(k||path.resolve(String(file))===dataDir)?!k||snapshot().has(k)||[...snapshot().keys()].some(x=>x.startsWith(k+'/')):nativeFs.existsSync(file);};
api.readFileSync=(file,options)=>{const k=key(file);if(!pool||!k)return nativeFs.readFileSync(file,options);const value=snapshot().get(k);if(value===undefined)throw Object.assign(Error('Stored document not found'),{code:'ENOENT'});return options?value:Buffer.from(value);};
api.writeFileSync=(file,value,options)=>{const k=key(file);if(!pool||!k)return nativeFs.writeFileSync(file,value,options);mutate(scope=>{scope.files.set(k,String(value));scope.dirty.add(k);scope.deleted.delete(k);});};
api.appendFileSync=(file,value,options)=>{const k=key(file);if(!pool||!k)return nativeFs.appendFileSync(file,value,options);mutate(scope=>{scope.files.set(k,(scope.files.get(k)||'')+String(value));scope.dirty.add(k);});};
api.renameSync=(from,to)=>{const a=key(from),b=key(to);if(!pool||!a||!b)return nativeFs.renameSync(from,to);mutate(scope=>{const value=scope.files.get(a);if(value===undefined)throw Error('Stored document not found');scope.files.set(b,value);scope.files.delete(a);scope.dirty.add(b);scope.dirty.delete(a);scope.deleted.add(a);scope.deleted.delete(b);});};
api.copyFileSync=(from,to)=>{const a=key(from),b=key(to);if(!pool||!a||!b)return nativeFs.copyFileSync(from,to);api.writeFileSync(to,api.readFileSync(from,'utf8'));};
api.statSync=file=>{const k=key(file);return pool&&k?{size:Buffer.byteLength(api.readFileSync(file,'utf8'))}:nativeFs.statSync(file);};
export default api;

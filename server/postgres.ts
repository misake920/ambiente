import {Worker} from 'node:worker_threads';
import 'pg';
const tables=['migrations','users','workspaces','members','sessions','objects','events','jobs','audit','one_time','leases','runtime_secrets'];
/** Translate the small, parameterized SQL subset used by this application. */
export function postgresSQL(sql:string,schema='dark'){
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema)||schema.startsWith('pg_'))throw new Error('Schema PostgreSQL inválido.');
 let index=0;
 const fragments=sql.split(/('(?:''|[^'])*'|"(?:""|[^"])*")/g);
 let result=fragments.map((part,i)=>{
  if(i%2)return part;
  let value=part.replace(/\buser\b/gi,'"user"').replace(/\?/g,()=>'$'+(++index));
  for(const name of tables){
   value=value.replace(new RegExp('\\b(FROM|JOIN|INTO|UPDATE|REFERENCES|TABLE IF NOT EXISTS|TABLE)\\s+'+name+'\\b','gi'),(_match,keyword)=>keyword+' "'+schema+'"."'+name+'"');
   value=value.replace(new RegExp('\\bON\\s+'+name+'\\s*\\(','gi'),'ON "'+schema+'"."'+name+'"(');
  }
  return value;
 }).join('');
 result=result.replace(/\bBEGIN IMMEDIATE\b/g,'BEGIN ISOLATION LEVEL SERIALIZABLE');
 result=result.replace(/json_extract\(data,\s*'\$\.([A-Za-z][A-Za-z0-9_]*)'\)/g,(_all,key)=>key==='confirmed'?`((data::jsonb->>'confirmed')::boolean)::int`:['amount','priority'].includes(key)?`(data::jsonb->>'${key}')::numeric`:`(data::jsonb->>'${key}')`);
 if(/INSERT OR IGNORE/i.test(result))result=result.replace(/INSERT OR IGNORE/gi,'INSERT').replace(/;?\s*$/,' ON CONFLICT DO NOTHING;');
 return result;
}
export type Database={exec:(sql:string)=>void;prepare:(sql:string)=>{all:(...params:any[])=>any[];get:(...params:any[])=>any;run:(...params:any[])=>{changes:number|bigint;lastInsertRowid?:number|bigint}};close:()=>void};
export class SyncPostgres implements Database{
 private control=new Int32Array(new SharedArrayBuffer(8));
 private bytes=new Uint8Array(new SharedArrayBuffer(8*1024*1024));
 private worker:Worker;
 private closed=false;
 private schema:string;
 constructor(connectionString:string,schema='dark'){
  this.schema=schema;
  this.worker=new Worker(new URL('./postgres-worker.js',import.meta.url),{execArgv:[],workerData:{connectionString,control:this.control.buffer,bytes:this.bytes.buffer,allowLocalPlaintext:process.env.NODE_ENV==='test',debug:process.env.NODE_ENV==='test'}});
  this.worker.on('error',()=>{this.closed=true;});
  this.worker.unref();
 }
 private request(message:Record<string,unknown>):any{
  if(this.closed)throw new Error('Banco fechado.');
  Atomics.store(this.control,0,0);Atomics.store(this.control,1,0);this.worker.postMessage(message);
  const status=Atomics.wait(this.control,0,0,30000);
  if(status==='timed-out'){this.closed=true;void this.worker.terminate();throw Object.assign(new Error('O banco remoto não respondeu dentro do prazo.'),{code:'DATABASE_TIMEOUT'});}
  const result=JSON.parse(new TextDecoder().decode(this.bytes.subarray(0,Atomics.load(this.control,1))));
  if(!result.ok)throw Object.assign(new Error('Consulta ao banco falhou ('+result.error.code+').'+(result.error.message?' '+result.error.message:'')),{code:result.error.code});
  return result.value;
 }
 exec(sql:string){this.request({sql:postgresSQL(sql,this.schema)});}
 prepare(sql:string){const query=postgresSQL(sql,this.schema);return{
  all:(...params:any[])=>this.request({sql:query,params}).rows,
  get:(...params:any[])=>this.request({sql:query,params}).rows[0],
  run:(...params:any[])=>({changes:this.request({sql:query,params}).changes}),
 };}
 close(){if(this.closed)return;this.request({close:true});this.closed=true;void this.worker.terminate();}
}

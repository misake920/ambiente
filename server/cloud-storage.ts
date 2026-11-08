import {createWriteStream} from 'node:fs';
import {stat,unlink} from 'node:fs/promises';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {dataDir} from './db.ts';
import {cloudMediaLimit} from './runtime.ts';

export const storageBucket='00-do-dark-media';
const serviceKey=()=>process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY||'';
const publicKey=()=>process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||process.env.VITE_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||'';
const projectURL=()=>process.env.SUPABASE_URL||process.env.VITE_PUBLIC_SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||'';
export const cloudStorageConfigured=()=>!!serviceKey()&&!!publicKey()&&!!projectURL();
function base(){
 const value=new URL(projectURL());if(value.protocol!=='https:'||value.username||value.password||!value.hostname.endsWith('.supabase.co'))throw Object.assign(new Error('Configure a URL HTTPS do projeto Supabase.'),{status:503});
 return value.origin+'/storage/v1';
}
async function storage(route:string,init:RequestInit={}){
 if(!cloudStorageConfigured())throw Object.assign(new Error('O armazenamento persistente ainda não está configurado.'),{status:503});
 const key=serviceKey();const headers={'Content-Type':'application/json',apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),...init.headers};
 const r=await fetch(base()+route,{...init,headers,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Object.assign(new Error('O armazenamento não confirmou a operação (HTTP '+r.status+').'),{status:502,storageStatus:r.status});
 return r;
}
const objectPath=(key:string)=>'/'+storageBucket+'/'+key.split('/').map(encodeURIComponent).join('/');
function absoluteURL(value:string){
 const url=value.startsWith('https://')?new URL(value):value.startsWith('/storage/v1/')?new URL(new URL(base()).origin+value):new URL(base()+'/'+value.replace(/^\//,''));
 if(url.origin!==new URL(base()).origin||!url.pathname.startsWith('/storage/v1/'))throw new Error('O armazenamento retornou uma URL inesperada.');return url.href;
}
export async function prepareStorage(){
 let bucket;
 try{bucket=await(await storage('/bucket/'+storageBucket)).json();}catch(error:any){if(error.storageStatus!==404&&error.storageStatus!==400)throw error;}
 if(bucket){if(bucket.public!==false)throw new Error('O bucket existente não é privado. Não foi alterado automaticamente.');return;}
 await storage('/bucket',{method:'POST',body:JSON.stringify({id:storageBucket,name:storageBucket,public:false,file_size_limit:cloudMediaLimit,allowed_mime_types:['video/mp4','video/quicktime','video/webm','image/png','image/jpeg','image/webp']})});
}
export async function signedUpload(key:string){
 const body=await(await storage('/object/upload/sign'+objectPath(key),{method:'POST',body:JSON.stringify({upsert:false})})).json();
 if(typeof body.url!=='string')throw new Error('O armazenamento não retornou o link de envio.');
 return {url:absoluteURL(body.url),headers:{apikey:publicKey(),'x-upsert':'false'}};
}
export async function signedDownload(key:string,expiresIn=60){
 const body=await(await storage('/object/sign'+objectPath(key),{method:'POST',body:JSON.stringify({expiresIn})})).json();
 const value=body.signedURL||body.signedUrl;if(typeof value!=='string')throw new Error('O armazenamento não retornou o link privado.');return absoluteURL(value);
}
export async function deleteCloudFile(key:string){await storage('/object/'+storageBucket,{method:'DELETE',body:JSON.stringify({prefixes:[key]})});}
export async function materialize(file:any){
 if(file.storage!=='supabase')return {filename:path.join(dataDir,'media',file.filename),cleanup:async()=>{}};
 const filename=path.join(dataDir,'media',randomUUID()),url=await signedDownload(file.objectKey,300);
 try{
  const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok||!r.body)throw new Error('Não foi possível ler o arquivo privado.');
  let size=0;const limit=new Transform({transform(chunk,_encoding,callback){size+=chunk.length;if(size>cloudMediaLimit)callback(new Error('Arquivo acima do limite do plano gratuito.'));else callback(null,chunk);}});
  await pipeline(Readable.fromWeb(r.body as any),limit,createWriteStream(filename,{flags:'wx',mode:0o600}));
  if(file.size!==undefined&&size!==file.size)throw new Error('O tamanho do arquivo não corresponde ao envio autorizado.');
  await stat(filename);
  return {filename,cleanup:async()=>{await unlink(filename).catch(()=>{});}};
 }catch(error){await unlink(filename).catch(()=>{});throw error;}
}

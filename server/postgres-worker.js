import {parentPort,workerData} from 'node:worker_threads';
import pg from 'pg';
import {X509Certificate} from 'node:crypto';
const control=new Int32Array(workerData.control),bytes=new Uint8Array(workerData.bytes);
pg.types.setTypeParser(20,value=>Number(value));
pg.types.setTypeParser(1700,value=>Number(value));
const url=new URL(workerData.connectionString);
const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
url.searchParams.delete('sslmode');url.searchParams.delete('pgbouncer');
const options={connectionString:url.href,ssl:local&&workerData.allowLocalPlaintext?false:{rejectUnauthorized:true},connectionTimeoutMillis:10000,query_timeout:20000,application_name:'00-do-dark'};
let rootCertificate;
async function configureTLS(){
 if(options.ssl===false)return;
 if(process.env.POSTGRES_CA){options.ssl.ca=process.env.POSTGRES_CA;return;}
 if(url.hostname.endsWith('.pooler.supabase.com')||url.hostname.endsWith('.supabase.co')){
  // Official root linked by the Supabase dashboard SSL Configuration panel.
  // Fetch with normal HTTPS verification, then trust it only for this DB client.
  if(!rootCertificate){
   const response=await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt',{redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Object.assign(new Error('Certificado raiz indisponível.'),{code:'DATABASE_CA_UNAVAILABLE'});
   const pem=await response.text(),certificate=new X509Certificate(pem);
   if(!certificate.ca||Date.parse(certificate.validTo)<=Date.now())throw Object.assign(new Error('Certificado raiz inválido.'),{code:'DATABASE_CA_INVALID'});
   rootCertificate=pem;
  }
  options.ssl.ca=rootCertificate;
 }
}
let client,connecting;
async function connection(){
 if(!client){
  await configureTLS();
  const created=new pg.Client(options);client=created;
  created.on('error',()=>{if(client===created){client=undefined;connecting=undefined;}});
  connecting=created.connect().catch(error=>{if(client===created){client=undefined;connecting=undefined;}throw error;});
 }
 await connecting;return client;
}
function reply(value){
 let encoded=new TextEncoder().encode(JSON.stringify(value));
 if(encoded.length>bytes.length)encoded=new TextEncoder().encode(JSON.stringify({ok:false,error:{code:'RESULT_TOO_LARGE'}}));
 bytes.set(encoded);Atomics.store(control,1,encoded.length);Atomics.store(control,0,1);Atomics.notify(control,0);
}
parentPort.on('message',async message=>{
 try{
  if(message.close){if(client)await client.end().catch(()=>{});reply({ok:true,value:null});parentPort.close();return;}
  const active=await connection();const response=await active.query(message.sql,message.params);
  const result=Array.isArray(response)?response.at(-1):response;
  reply({ok:true,value:{rows:result?.rows||[],changes:result?.rowCount||0}});
 }catch(error){reply({ok:false,error:{code:typeof error.code==='string'?error.code:'DATABASE_ERROR',message:workerData.debug?error.message:undefined}});}
});

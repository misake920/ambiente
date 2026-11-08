import {parentPort,workerData} from 'node:worker_threads';
import pg from 'pg';
const control=new Int32Array(workerData.control),bytes=new Uint8Array(workerData.bytes);
pg.types.setTypeParser(20,value=>Number(value));
pg.types.setTypeParser(1700,value=>Number(value));
const url=new URL(workerData.connectionString);
const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
url.searchParams.delete('sslmode');url.searchParams.delete('pgbouncer');
const options={connectionString:url.href,ssl:local&&workerData.allowLocalPlaintext?false:{rejectUnauthorized:true},connectionTimeoutMillis:10000,query_timeout:20000,application_name:'00-do-dark'};
let client,connecting;
async function connection(){
 if(!client){
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

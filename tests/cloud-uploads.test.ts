import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import request from 'supertest';
process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'dark-cloud-test-'));
Object.assign(process.env,{NODE_ENV:'test',POSTGRES_URL:'',DARK_SERVERLESS:'1',ENCRYPTION_KEY:'12'.repeat(32),SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_server',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test_browser'});
const {app}=await import('../server/app.ts');
const {db,list}=await import('../server/db.ts');
const {signedUpload}=await import('../server/cloud-storage.ts');
const alice=request.agent(app),bob=request.agent(app);
const originalFetch=globalThis.fetch;
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8z8AAAAASUVORK5CYII=','base64');
let bytes:Buffer=image,deletions=0,workspace='';
globalThis.fetch=async(input:any,init:any={})=>{
 const url=new URL(String(input));assert.equal(url.origin,'https://example.supabase.co');
 if(url.pathname.includes('/object/upload/sign/')){assert.equal(init.headers.apikey,process.env.SUPABASE_SECRET_KEY);assert(!init.headers.Authorization);return Response.json({url:url.pathname.replace('/storage/v1','')+'?token=upload-test'});}
 if(init.method==='POST'&&url.pathname.startsWith('/storage/v1/object/sign/'))return Response.json({signedURL:url.pathname+'?token=download-test'});
 if(init.method==='DELETE'){deletions++;return Response.json({});}
 if(url.searchParams.get('token')==='download-test')return new Response(new Uint8Array(bytes));
 throw new Error('Unexpected storage operation.');
};
after(()=>{globalThis.fetch=originalFetch;db.close();rmSync(process.env.DATA_DIR!,{recursive:true,force:true});});
test('signed upload validates a real image and keeps service credentials on the server',async()=>{
 await alice.post('/api/auth/register').send({name:'Alice',email:'cloud-alice@example.com',password:'test-password-1234'});
 await bob.post('/api/auth/register').send({name:'Bob',email:'cloud-bob@example.com',password:'test-password-5678'});
 workspace=(await alice.get('/api/me')).body.workspace;
 const prepared=await alice.post('/api/uploads/prepare').send({kind:'artwork',name:'avatar.png',mime:'image/png',size:image.length});assert.equal(prepared.status,201);
 assert.equal(prepared.body.headers.apikey,process.env.SUPABASE_PUBLISHABLE_KEY);assert(!JSON.stringify(prepared.body).includes(process.env.SUPABASE_SECRET_KEY!));
 assert.equal((await bob.post('/api/uploads/complete').send({id:prepared.body.id})).status,404);
 const done=await alice.post('/api/uploads/complete').send({id:prepared.body.id});assert.equal(done.status,201);assert.equal(done.body.storage,'supabase');assert.equal(done.body.width,1);assert.equal(list(workspace,'upload').length,0);
 assert.equal((await alice.post('/api/uploads/complete').send({id:prepared.body.id})).status,404);
});
test('corrupt and incomplete uploads are rejected and release their storage reservations',async()=>{
 bytes=Buffer.from('invalid image');
 const prepared=await alice.post('/api/uploads/prepare').send({kind:'artwork',name:'invalid.png',mime:'image/png',size:bytes.length});assert.equal(prepared.status,201);
 const result=await alice.post('/api/uploads/complete').send({id:prepared.body.id});assert.equal(result.status,400);assert.equal(deletions,1);assert.equal(list(workspace,'upload').length,0);assert.equal(list(workspace,'artwork').length,1);
 bytes=image;
});
test('upload limits and service-returned destinations are checked before trusting them',async()=>{
 assert.equal((await alice.post('/api/uploads/prepare').send({kind:'media',name:'big.mp4',mime:'video/mp4',size:51*1024*1024})).status,400);
 assert.equal((await alice.post('/api/uploads/prepare').send({kind:'artwork',name:'big.png',mime:'image/png',size:11*1024*1024})).status,400);
 globalThis.fetch=async()=>Response.json({url:'https://other.example/steal'});
 await assert.rejects(signedUpload('test/object'),/inesperada/);
});

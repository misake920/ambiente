import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import request from 'supertest';
Object.assign(process.env,{NODE_ENV:'test',POSTGRES_URL:'',DATA_DIR:mkdtempSync(path.join(tmpdir(),'dark-pix-')),APP_ORIGIN:'http://localhost:5173'});
const {db,settings,list,put,jobs}=await import('../server/db.ts');
const {app}=await import('../server/app.ts');
const {connectLivePix,pollLivePix}=await import('../server/livepix.ts');
const {publicAccount}=await import('../server/security.ts');
const {saveOAuth,oauthConfig}=await import('../server/connector-config.ts');
const workspace=randomUUID(),other=randomUUID();
for(const id of [workspace,other]){db.prepare('INSERT INTO workspaces VALUES(?,?,0,?)').run(id,'Real test workspace',Date.now());settings(id);}
put(workspace,'rule',{name:'Mensagem de apoio',trigger:'donation',enabled:true,minAmount:0,priority:20,cooldown:0,action:'speak',speech:'{usuario}: {mensagem}',duration:3});
let integration:any,payments:any[]=[],messages:any[]=[],rejectAccess=false,authorizationChecks=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
 const url=new URL(String(input));assert(['api.livepix.gg','oauth.livepix.gg'].includes(url.hostname));
 if(url.pathname==='/oauth2/token'){const fields=new URLSearchParams(String(init.body));assert.equal(fields.get('grant_type'),'client_credentials');return Response.json({access_token:'livepix-test-private-token',expires_in:3600});}
 assert.equal((init.headers as any).Authorization,'Bearer livepix-test-private-token');authorizationChecks++;
 if(url.pathname==='/v2/account')return Response.json({data:{id:'account-pix-123',displayName:'Meu canal',username:'meucanal'}});
 if(url.pathname==='/v2/payments')return rejectAccess?Response.json({message:'Forbidden'},{status:403}):Response.json({data:payments});
 if(url.pathname==='/v2/messages')return Response.json({data:messages});
 throw new Error('Unexpected API call.');
};
after(()=>{globalThis.fetch=originalFetch;db.close();rmSync(process.env.DATA_DIR!,{recursive:true,force:true});});
test('LivePix refuses a connection without access to the financial API',async()=>{rejectAccess=true;await assert.rejects(connectLivePix(workspace,'application-id','private-client-secret'),/escopos/);assert.equal(list(workspace,'integration').length,0);rejectAccess=false;});
test('LivePix validates access and does not expose credentials or fabricate receipts',async()=>{
 integration=await connectLivePix(workspace,'application-id','private-client-secret');assert.equal(integration.paymentsEnabled,true);const safe=publicAccount(integration);assert(!safe.tokens&&!safe.credentials&&!safe.webhookHash);assert(!JSON.stringify(safe).includes('private-client-secret'));assert.equal(db.prepare('SELECT COUNT(*) AS count FROM events WHERE workspace=?').get(workspace).count,0);
});
test('authenticated receipts are deduplicated, old payments and other currencies are ignored',async()=>{
 const stamp=new Date(integration.connectedAt+1).toISOString();payments=[{id:'received-1',proof:'pix-proof-1',amount:1000,currency:'BRL',createdAt:stamp},{id:'historical',amount:9000,currency:'BRL',createdAt:new Date(integration.connectedAt-1000).toISOString()},{id:'foreign',amount:1000,currency:'USD',createdAt:stamp}];messages=[{id:'message-1',proof:'pix-proof-1',username:'Apoiador real',message:'Conteúdo aprovado',flagged:false,createdAt:stamp}];
 assert.equal((await pollLivePix(workspace,integration)).received,1);assert.equal((await pollLivePix(workspace,integration)).received,0);const events=db.prepare('SELECT * FROM events WHERE workspace=?').all(workspace);assert.equal(events.length,1);assert.equal(events[0].is_test,0);assert.equal(JSON.parse(events[0].data).amount,1000);assert.equal(jobs(workspace).length,1);assert.equal(jobs(workspace)[0].data.user,'Apoiador real');assert(authorizationChecks>0);
});
test('provider moderation preserves confirmed revenue and prevents speech',async()=>{
 const stamp=new Date(integration.connectedAt+2).toISOString();payments=[{id:'received-2',proof:'pix-proof-2',amount:2000,currency:'BRL',createdAt:stamp}];messages=[{proof:'pix-proof-2',username:'Apoiador',message:'Texto sinalizado',flagged:true,createdAt:stamp}];await pollLivePix(workspace,integration);assert.equal(jobs(workspace).length,1);const event=db.prepare('SELECT data FROM events WHERE workspace=? AND external_id=?').get(workspace,'account-pix-123:received-2');assert.equal(JSON.parse(event.data).status,'blocked');assert.equal(JSON.parse(event.data).confirmed,true);
});
test('application OAuth settings are encrypted and isolated by workspace',()=>{saveOAuth('youtube',workspace,'youtube-application-id','youtube-private-secret');assert.equal(oauthConfig('youtube',workspace).clientSecret,'youtube-private-secret');assert.notEqual(oauthConfig('youtube',other).clientSecret,'youtube-private-secret');assert(!list(workspace,'connector-config')[0].secret.includes('youtube-private-secret'));});
test('public webhook bodies cannot create payments',async()=>{const before=db.prepare('SELECT COUNT(*) AS count FROM events').get().count;const response=await request(app).post('/api/hooks/livepix/'+'a'.repeat(64)).send({amount:99999999,confirmed:true,user:'Inventado'});assert.equal(response.status,404);assert.equal(db.prepare('SELECT COUNT(*) AS count FROM events').get().count,before);});
test('a supporter-covered fee does not increase the donation amount that triggers rules',async()=>{
 const stamp=new Date(integration.connectedAt+3).toISOString();payments=[{id:'received-cover-fees',proof:'pix-proof-fees',amount:1053,currency:'BRL',createdAt:stamp}];messages=[{proof:'pix-proof-fees',username:'Apoiador',message:'Apoio de dez reais',coverFees:true,fee:53,createdAt:stamp}];await pollLivePix(workspace,integration);const row=db.prepare('SELECT data FROM events WHERE workspace=? AND external_id=?').get(workspace,'account-pix-123:received-cover-fees');assert.equal(JSON.parse(row.data).amount,1000);
});
test('a read-only application can connect without optional webhook permission',async()=>{
 const previousFetch=globalThis.fetch;let scopes:string[]=[];
 globalThis.fetch=async(input,init={})=>{if(String(input).includes('/oauth2/token')){const requested=new URLSearchParams(String(init.body)).get('scope')!;scopes.push(requested);if(requested.split(' ').includes('webhooks'))return Response.json({error:'invalid_scope'},{status:400});}return previousFetch(input,init);};
 try{const linked=await connectLivePix(other,'read-only-application','private-client-secret');assert.equal(linked.paymentsEnabled,true);assert.equal(scopes.length,2);assert(!scopes[1].includes('webhooks'));}finally{globalThis.fetch=previousFetch;}
});
test('a full page of historical receipts does not hide a new receipt on the following page',async()=>{
 const previousFetch=globalThis.fetch,stamp=new Date(integration.connectedAt+4).toISOString();
 const old=Array.from({length:100},(_,i)=>({id:'old-page-'+i,amount:1000,currency:'BRL',createdAt:new Date(integration.connectedAt-1000).toISOString()}));
 globalThis.fetch=async(input,init={})=>{const url=new URL(String(input));if(url.pathname==='/v2/payments')return Response.json({data:url.searchParams.get('page')==='1'?old:[{id:'received-page-2',proof:'proof-page-2',amount:3000,currency:'BRL',createdAt:stamp}]});if(url.pathname==='/v2/messages')return Response.json({data:[{proof:'proof-page-2',username:'Apoiador da segunda página',message:'Apoio recebido',createdAt:stamp}]});return previousFetch(input,init);};
 try{assert.equal((await pollLivePix(workspace,integration)).received,1);assert(db.prepare('SELECT 1 FROM events WHERE workspace=? AND external_id=?').get(workspace,'account-pix-123:received-page-2'));}finally{globalThis.fetch=previousFetch;}
});

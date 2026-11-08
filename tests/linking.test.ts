import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
process.env.NODE_ENV='test';process.env.POSTGRES_URL='';process.env.DATA_DIR=mkdtempSync(path.join(tmpdir(),'dark-link-test-'));
const {db,settings,list}=await import('../server/db.ts');
const {beginLink,finishLink,validatePlatformLink,revokeTikTok}=await import('../server/oauth-links.ts');
const workspace=randomUUID(),other=randomUUID(),user=randomUUID();
for(const id of [workspace,other]){db.prepare('INSERT INTO workspaces VALUES(?,?,0,?)').run(id,'Link test',Date.now());settings(id);}
after(()=>{db.close();rmSync(process.env.DATA_DIR!,{recursive:true,force:true});});
test('assisted links stay on their platform and never accept credentials or active content',()=>{
 assert.equal(validatePlatformLink('tiktok','https://www.tiktok.com/@dark/live'),'https://www.tiktok.com/@dark/live');
 assert.equal(validatePlatformLink('youtube','https://youtu.be/abc'),'https://youtu.be/abc');
 for(const url of ['javascript:alert(1)','http://www.tiktok.com/@dark','https://tiktok.com.evil.example/live','https://secret@www.tiktok.com/@dark','https://www.youtube.com/watch?v=abc'])assert.throws(()=>validatePlatformLink('tiktok',url));
});
test('official linking requires configured credentials and a real signed-in user',()=>{
 process.env.TIKTOK_CLIENT_KEY='';process.env.TIKTOK_CLIENT_SECRET='';
 assert.throws(()=>beginLink('tiktok',workspace,user));assert.throws(()=>beginLink('tiktok',workspace,null));
});
test('TikTok authorization is bound to workspace/user, single use, and stores no plaintext tokens',async()=>{
 process.env.TIKTOK_CLIENT_KEY='test-app-key';process.env.TIKTOK_CLIENT_SECRET='test-app-secret';
 const url=new URL(beginLink('tiktok',workspace,user)),state=url.searchParams.get('state')!;
 assert.equal(url.origin,'https://www.tiktok.com');assert.equal(url.searchParams.get('scope'),'user.info.basic');
 assert(!url.href.includes('test-app-secret'));
 let calls=0;const original=globalThis.fetch;
 globalThis.fetch=async(input,options)=>{
  calls++;const target=String(input);
  if(target==='https://open.tiktokapis.com/v2/oauth/token/'){
   const body=new URLSearchParams(options?.body as string);assert.equal(body.get('client_secret'),'test-app-secret');
   return Response.json({access_token:'private-test-token',refresh_token:'private-test-refresh',expires_in:86400,scope:'user.info.basic',open_id:'test-open-id'});
  }
  if(target.startsWith('https://open.tiktokapis.com/v2/user/info/'))return Response.json({data:{user:{open_id:'test-open-id',display_name:'Dark test'}},error:{code:'ok'}});
  if(target==='https://open.tiktokapis.com/v2/oauth/revoke/')return new Response(null,{status:204});
  throw new Error('Unexpected remote endpoint');
 };
 try{
  await assert.rejects(finishLink('tiktok',other,user,state,'test-code'));await assert.rejects(finishLink('tiktok',workspace,'other-user',state,'test-code'));assert.equal(calls,0);
  const linked=await finishLink('tiktok',workspace,user,state,'test-code');assert.equal(linked.status,'connected');assert.deepEqual(linked.permissions,['Identidade']);assert.equal(linked.chatEnabled,false);assert(!linked.tokens.includes('private-test-token'));
  await assert.rejects(finishLink('tiktok',workspace,user,state,'test-code'));assert.equal(calls,2);
  await revokeTikTok(linked);assert.equal(calls,3);
 }finally{globalThis.fetch=original;process.env.TIKTOK_CLIENT_KEY='';process.env.TIKTOK_CLIENT_SECRET='';}
});
test('LivePix identity authorization does not create payments or publication destinations',async()=>{
 process.env.LIVEPIX_CLIENT_ID='test-livepix-id';process.env.LIVEPIX_CLIENT_SECRET='test-livepix-secret';
 const start=new URL(beginLink('livepix',workspace,user));assert.equal(start.origin,'https://oauth.livepix.gg');assert.equal(start.searchParams.get('scope'),'account:read offline');
 const original=globalThis.fetch;
 globalThis.fetch=async input=>String(input).includes('/oauth2/token')?Response.json({access_token:'private-livepix-token',expires_in:3600}):Response.json({data:{id:'test-livepix-account',username:'darktest',displayName:'Dark test'}});
 try{
  await finishLink('livepix',workspace,user,start.searchParams.get('state')!,'test-code');
  assert.equal(list(workspace,'integration').length,1);assert.equal(list(workspace,'account').filter(a=>a.platform==='livepix').length,0);assert.equal(db.prepare('SELECT COUNT(*) AS count FROM events WHERE workspace=?').get(workspace).count,0);
 }finally{globalThis.fetch=original;process.env.LIVEPIX_CLIENT_ID='';process.env.LIVEPIX_CLIENT_SECRET='';}
});

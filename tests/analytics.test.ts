import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
Object.assign(process.env,{NODE_ENV:'test',POSTGRES_URL:'',DATA_DIR:mkdtempSync(path.join(tmpdir(),'dark-analytics-')),APP_ORIGIN:'http://localhost:5173'});
const {db,settings,put,get}=await import('../server/db.ts');
const {encrypt}=await import('../server/security.ts');
const {revenueSeries,audienceMetrics}=await import('../server/analytics.ts');
const {pollYouTube}=await import('../server/connectors.ts');
const originalFetch=globalThis.fetch;
after(()=>{globalThis.fetch=originalFetch;db.close();rmSync(process.env.DATA_DIR!,{recursive:true,force:true});});
function workspace(){const id=randomUUID();db.prepare('INSERT INTO workspaces VALUES(?,?,0,?)').run(id,'Analytics test',Date.now());settings(id);return id;}
function event(w:string,created:number,data:Record<string,any>={},kind='donation',isTest=false){
 db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),w,randomUUID(),kind==='gift'?'youtube':'livepix',kind,JSON.stringify({amount:100,confirmed:true,...data}),+isTest,created);
}
function youtube(w:string,data:Record<string,any>={}){return put(w,'account',{platform:'youtube',externalId:'channel-1',status:'connected',chatEnabled:true,tokens:encrypt(JSON.stringify({access_token:'test-youtube-token',expires_at:Date.now()+3600000})),...data});}

test('revenue reads beyond the activity feed and excludes tests, pending, old and other workspaces',()=>{
 const w=workspace(),other=workspace(),now=Date.now();
 for(let i=0;i<550;i++)event(w,now-1000-i);
 event(w,now,{amount:900000},'donation',true);event(w,now,{amount:800000,confirmed:false});event(w,now-86400001,{amount:700000});event(w,now+1,{amount:600000});event(other,now,{amount:500000});
 const series=revenueSeries(w,now);assert.equal(series.total,55000);assert.equal(series.points.length,9);assert.equal(series.points.at(-1)?.amount,55000);assert.equal(series.points[0].amount,0);
});
test('cumulative chart includes donations exactly on each time boundary',()=>{
 const w=workspace(),now=Date.now(),start=now-86400000;
 event(w,start);event(w,start+1,{amount:200});event(w,start+10800000,{amount:300});event(w,now,{amount:400});
 const {points,total}=revenueSeries(w,now);assert.deepEqual(points.map(p=>p.amount),[100,600,600,600,600,600,600,600,1000]);assert.equal(total,1000);
 assert(revenueSeries(workspace(),now).points.every(p=>p.amount===0));
});
test('audience metrics distinguish missing data, deduplicate broadcasts and count captured gifts only',()=>{
 const w=workspace(),now=Date.now();assert.equal(audienceMetrics(w,now).views.value,null);
 const live={id:'video-1',views:1200,likes:45,updatedAt:now,chatSyncedAt:now};
 const a=youtube(w,{liveMetrics:{checkedAt:now,broadcasts:[live]}});
 youtube(w,{liveMetrics:{checkedAt:now,broadcasts:[{...live,updatedAt:now-1000}]}});
 event(w,now,{liveId:'video-1',giftQuantity:5,amount:0},'gift');event(w,now,{liveId:'old-video',giftQuantity:99,amount:0},'gift');event(w,now,{liveId:'video-1',giftQuantity:99,amount:0},'gift',true);
 const m=audienceMetrics(w,now);assert.equal(m.views.value,1200);assert.equal(m.likes.value,45);assert.equal(m.gifts.value,5);assert.equal(m.activeLives,1);assert.equal(revenueSeries(w,now).total,0);
 put(w,'account',{liveMetrics:{checkedAt:now,broadcasts:[{...live,likes:null}]}},a.id);
 const other=get(w,'account',a.id)!;assert.equal(other.liveMetrics.broadcasts[0].likes,null);
 assert.equal(audienceMetrics(w,now+180001).views.value,null);
 const missing=workspace();youtube(missing,{chatEnabled:false,liveMetrics:{checkedAt:now,broadcasts:[{...live,likes:null}]}});
 assert.equal(audienceMetrics(missing,now).likes.value,null);assert.equal(audienceMetrics(missing,now).gifts.value,null);
});
test('official YouTube responses populate real metrics and gifts without counting recipient notices twice',async()=>{
 const w=workspace();let account=youtube(w),chatRequests=0;
 globalThis.fetch=async(input,init)=>{
  assert.equal((init?.headers as any).Authorization,'Bearer test-youtube-token');const url=new URL(String(input));
  if(url.pathname.endsWith('/liveBroadcasts'))return Response.json({items:[{id:'video-1',snippet:{channelId:'channel-1',liveChatId:'chat-1',title:'Minha live'}},{id:'unrelated',snippet:{channelId:'other-channel'}}]});
  if(url.pathname.endsWith('/videos'))return Response.json({items:[{id:'video-1',statistics:{viewCount:'2468',likeCount:'81'},liveStreamingDetails:{concurrentViewers:'32'}}]});
  if(url.pathname.endsWith('/liveChat/messages')){chatRequests++;return Response.json({pollingIntervalMillis:15000,nextPageToken:'page-2',items:[
   {id:'batch',snippet:{type:'membershipGiftingEvent',membershipGiftingDetails:{giftMembershipsCount:5}},authorDetails:{displayName:'Apoiador'}},
   {id:'recipient',snippet:{type:'giftMembershipReceivedEvent'},authorDetails:{displayName:'Destinatário'}},
   {id:'sticker',snippet:{type:'superStickerEvent'},authorDetails:{displayName:'Apoiador'}},
   {id:'gift',snippet:{type:'giftEvent',giftDetails:{comboCount:3,giftName:'Presente'}},authorDetails:{displayName:'Apoiador'}},
   {id:'text',snippet:{type:'textMessageEvent',displayMessage:'Olá!'},authorDetails:{displayName:'Pessoa'}},
   {id:'deleted',snippet:{type:'messageDeletedEvent'}}
  ]});}
  throw new Error('Unexpected YouTube endpoint');
 };
 try{
  assert.equal((await pollYouTube(w,account)).next,15000);account=get(w,'account',account.id)!;
  const metrics=audienceMetrics(w);assert.equal(metrics.views.value,2468);assert.equal(metrics.likes.value,81);assert.equal(metrics.gifts.value,9);
  assert.equal(account.liveMetrics.broadcasts[0].concurrentViewers,32);
  account.liveMetrics.broadcasts[0].chatNextAt=0;await pollYouTube(w,account);
  assert.equal(chatRequests,2);assert.equal(audienceMetrics(w).gifts.value,9);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events WHERE workspace=?').get(w).n,4);assert.equal(revenueSeries(w).total,0);
 }finally{globalThis.fetch=originalFetch;}
});
test('YouTube metrics work with chat disabled; ended broadcasts and hidden likes are not invented',async()=>{
 const w=workspace();let account=youtube(w,{chatEnabled:false}),ended=false;
 globalThis.fetch=async input=>{
  const url=new URL(String(input));
  if(url.pathname.endsWith('/liveBroadcasts'))return Response.json({items:[{id:'video-1',snippet:{channelId:'channel-1',liveChatId:'chat-1',title:'Minha live'}}]});
  if(url.pathname.endsWith('/videos'))return Response.json({items:[{id:'video-1',statistics:{viewCount:'0'},liveStreamingDetails:ended?{actualEndTime:new Date().toISOString()}:{}}]});
  throw new Error('Chat must not be requested when disabled');
 };
 try{
  await pollYouTube(w,account);assert.equal(audienceMetrics(w).views.value,0);assert.equal(audienceMetrics(w).likes.value,null);assert.equal(audienceMetrics(w).gifts.value,null);
  account=get(w,'account',account.id)!;account.liveMetrics.broadcasts[0].updatedAt=0;ended=true;await pollYouTube(w,account);
  assert.equal(audienceMetrics(w).views.value,null);assert.equal(get(w,'account',account.id)!.liveChatId,null);
 }finally{globalThis.fetch=originalFetch;}
});
test('a chat access error preserves video statistics and makes gift availability explicit',async()=>{
 const w=workspace(),account=youtube(w);
 globalThis.fetch=async input=>{
  const url=new URL(String(input));
  if(url.pathname.endsWith('/liveBroadcasts'))return Response.json({items:[{id:'video-1',snippet:{channelId:'channel-1',liveChatId:'chat-1'}}]});
  if(url.pathname.endsWith('/videos'))return Response.json({items:[{id:'video-1',statistics:{viewCount:'13',likeCount:'2'}}]});
  return Response.json({error:'Chat disabled'},{status:403});
 };
 try{const result=await pollYouTube(w,account);assert.match(result.warning||'',/não foi possível ler o chat/);assert.equal(audienceMetrics(w).views.value,13);assert.equal(audienceMetrics(w).gifts.value,null);}finally{globalThis.fetch=originalFetch;}
});

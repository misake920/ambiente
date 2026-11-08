import {db,list} from './db.ts';

/** Amounts stay in cents; read the full ledger rather than the 500-event activity feed. */
export function revenueSeries(workspace:string,now=Date.now()){
 const start=now-86400000,span=10800000;
 const rows=db.prepare(`SELECT CAST((created-CAST(? AS BIGINT)+CAST(? AS BIGINT)-1)/CAST(? AS BIGINT) AS BIGINT) AS bucket,
  COALESCE(SUM(json_extract(data,'$.amount')),0) AS amount FROM events
  WHERE workspace=? AND kind='donation' AND is_test=0 AND json_extract(data,'$.confirmed')=1 AND created>=? AND created<=?
  GROUP BY bucket ORDER BY bucket`).all(start,span,span,workspace,start,now) as {bucket:number;amount:number}[];
 let amount=0;
 const points=Array.from({length:9},(_,i)=>{amount+=Number(rows.find(r=>Number(r.bucket)===i)?.amount||0);return {at:start+i*span,amount};});
 return {points,total:amount,updatedAt:now};
}

type Metric={value:number|null;status:'available'|'partial'|'unavailable'|'stale';reason:string;updatedAt?:number};
export function audienceMetrics(workspace:string,now=Date.now()){
 const accounts=list(workspace,'account').filter(a=>a.platform==='youtube'&&a.status==='connected'&&!a.isDemo);
 const broadcasts=new Map<string,any>();let unmeasured=0;
 for(const account of accounts){
  const snapshot=account.liveMetrics;
   if(!snapshot||!Number.isFinite(snapshot.checkedAt)||now-snapshot.checkedAt>180000){unmeasured++;continue;}
  for(const live of snapshot.broadcasts||[]){
   if(!Number.isFinite(live.updatedAt)||now-live.updatedAt>180000){unmeasured++;continue;}
   const previous=broadcasts.get(live.id);
   if(!previous||previous.updatedAt<live.updatedAt)broadcasts.set(live.id,{...live,chatEnabled:!!account.chatEnabled,chatAvailable:!!account.chatEnabled&&Number.isFinite(live.chatSyncedAt)&&now-live.chatSyncedAt<=180000});
  }
 }
 const lives=[...broadcasts.values()];
 const reason=!accounts.length?'Conecte uma conta YouTube':unmeasured?'Aguardando atualização do YouTube':'Nenhuma live ativa no YouTube';
 function metric(key:'views'|'likes'):Metric{
  const measured=lives.filter(l=>Number.isSafeInteger(l[key])&&l[key]>=0);
  if(!measured.length)return {value:null,status:unmeasured?'stale':'unavailable',reason:lives.length?'Métrica não informada pelo YouTube':reason};
  const partial=unmeasured>0||measured.length<lives.length;
  return {value:measured.reduce((sum,l)=>sum+l[key],0),status:partial?'partial':'available',reason:partial?'YouTube · dados parciais':'YouTube · lives ativas',updatedAt:Math.min(...measured.map(l=>l.updatedAt))};
 }
 const tracked=lives.filter(l=>l.chatAvailable);
 let gifts:Metric={value:null,status:unmeasured?'stale':'unavailable',reason:lives.length?(lives.some(l=>l.chatEnabled)?'Aguardando acesso ao chat':'Ative a leitura do chat no YouTube'):reason};
 if(tracked.length){
  const ids=tracked.map(l=>l.id),placeholders=ids.map(()=>'?').join(',');
  const row=db.prepare(`SELECT COALESCE(SUM(CAST(json_extract(data,'$.giftQuantity') AS BIGINT)),0) AS total FROM events WHERE workspace=? AND provider='youtube' AND kind='gift' AND is_test=0 AND json_extract(data,'$.confirmed')=1 AND json_extract(data,'$.liveId') IN (${placeholders})`).get(workspace,...ids);
  gifts={value:Number(row.total),status:unmeasured||tracked.length<lives.length?'partial':'available',reason:'YouTube · capturados pelo chat',updatedAt:Math.min(...tracked.map(l=>l.chatSyncedAt))};
 }
 return {views:metric('views'),likes:metric('likes'),gifts,activeLives:lives.length};
}

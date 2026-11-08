import {list,put,acquireLease,extendLease,log} from './db.ts';
import {pollLivePix} from './livepix.ts';
import {pollYouTube} from './connectors.ts';
export async function syncWorkspace(workspace:string){
 const providers=[...list(workspace,'integration').filter(a=>a.platform==='livepix'&&a.paymentsEnabled),...list(workspace,'account').filter(a=>a.platform==='youtube'&&a.chatEnabled&&!a.isDemo)];
 const result=[];
 for(const account of providers){
  if(account.status!=='connected')continue;
  const key=(account.platform==='livepix'?'livepix-sync:':'youtube-chat:')+account.id,lease=acquireLease(key,60000);if(!lease)continue;
  try{
   const response=account.platform==='livepix'?await pollLivePix(workspace,account):await pollYouTube(workspace,account);
   extendLease(key,lease,Date.now()+Math.max(10000,response.next));
   if(account.platform==='youtube')put(workspace,'account',{lastSyncAt:Date.now(),lastError:null},account.id);
   result.push({platform:account.platform,ok:true});
  }catch(error:any){
   const kind=account.platform==='livepix'?'integration':'account';
   put(workspace,kind,{lastError:error.message,lastSyncAt:Date.now(),...(error.remoteStatus===401?{status:'expired'}:{})},account.id);
   extendLease(key,lease,Date.now()+30000);log(workspace,'Falha de sincronização '+account.platform+'. '+error.message);result.push({platform:account.platform,ok:false,error:error.message});
  }
 }
 return result;
}

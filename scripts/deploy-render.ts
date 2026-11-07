import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {renderServicePayload,renderServiceName,renderRepository} from './render-config.ts';

// Default is read-only preparation. --create provisions a paid Starter + disk.
async function main(){
 if(!process.env.RENDER_API_KEY)throw new Error('Conecte RENDER_API_KEY nos segredos do ambiente (destino api.render.com). Não envie a chave no chat.');
 const api=async(route:string,init:RequestInit={})=>{
  const r=await fetch('https://api.render.com/v1'+route,{...init,headers:{Authorization:'Bearer '+process.env.RENDER_API_KEY,Accept:'application/json',...init.headers},signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw new Error(`Render HTTP ${r.status}. Verifique acesso, faturamento e configuração pelo painel do provedor.`);return r.json();
 };
 const owners=await api('/owners?limit=100');
 const ids=owners.map((entry:any)=>entry.owner?.id).filter(Boolean);
 const ownerId=process.env.RENDER_OWNER_ID||(ids.length===1?ids[0]:null);
 if(!ownerId||!ids.includes(ownerId))throw new Error('Há mais de um workspace Render; defina RENDER_OWNER_ID para escolher o destino.');
 const payload=renderServicePayload(ownerId);
 mkdirSync('.render',{recursive:true});writeFileSync('.render/proposal.json',JSON.stringify(payload,null,2)+'\n');
 console.log('Proposta: serviço Docker Starter, 1 instância, Ohio, disco persistente de 1 GB em /data.');
 console.log('Esse serviço é pago. Confira o preço vigente no Render antes de executar --create.');
 const listed=await api('/services?ownerId='+encodeURIComponent(ownerId)+'&name='+encodeURIComponent(renderServiceName)+'&limit=100');
 let service;
 if(existsSync('.render/service.json')){
  const saved=JSON.parse(readFileSync('.render/service.json','utf8'));service=await api('/services/'+encodeURIComponent(saved.id));
  if(service.name!==renderServiceName||service.ownerId!==ownerId||service.repo!==renderRepository)throw new Error('O serviço salvo não corresponde ao projeto; nenhum recurso foi alterado.');
 }else if(listed.some((entry:any)=>entry.service?.name===renderServiceName))throw new Error('Já existe um serviço com esse nome. Revise-o antes de vincular; nenhum recurso foi alterado.');
 if(!process.argv.includes('--create')){console.log('Somente preparação concluída; nenhum serviço contratado.');return;}
 if(!service){
  const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const remote=execFileSync('git',['ls-remote','origin','refs/heads/main'],{encoding:'utf8'}).trim().split(/\s/)[0];
  if(commit!==remote)throw new Error('Publique o commit atual em main antes de criar o serviço Render.');
  const result=await api('/services',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});service=result.service;
  if(!service?.id)throw new Error('O Render não confirmou o identificador do serviço. Verifique o painel antes de repetir a criação.');
  writeFileSync('.render/service.json',JSON.stringify({id:service.id,ownerId,url:service.serviceDetails?.url},null,2)+'\n');
 }
 const url=service.serviceDetails?.url;
 if(!url||new URL(url).protocol!=='https:')throw new Error('O Render ainda não retornou a URL HTTPS do serviço.');
 console.log('Serviço Render: '+url+' — aguardando build e health check.');
 for(let i=0;i<180;i++){
  let healthy=false;
  try{
   const r=await fetch(url+'/api/health',{signal:AbortSignal.timeout(10000)}),health=await r.json();
   healthy=r.ok&&health.status==='ok'&&health.database===true&&health.publicOrigin==='https://00-do-dark.vercel.app';
  }catch{}
  if(healthy){
    process.env.BACKEND_URL=url;console.log('Backend e banco disponíveis; publicando a aplicação completa na Vercel.');
    execFileSync('npm',['run','build'],{stdio:'inherit'});execFileSync('npm',['run','deploy:vercel'],{env:process.env,stdio:'inherit'});return;
  }
  if(i%6===0)console.log('Aguardando disponibilidade do backend...');
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 throw new Error('Backend ainda indisponível. O identificador foi salvo em .render/service.json; execute novamente para verificar sem recriar.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

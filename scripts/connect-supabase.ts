import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {getProject} from './vercel-upload.ts';

export const deploymentPrivateDir=path.resolve('..','.cache','00-do-dark-deployment');
const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'";
export async function supabaseManagement(route:string,init:RequestInit={}){
 if(!process.env.SUPABASE_ACCESS_TOKEN)throw new Error('Conecte SUPABASE_ACCESS_TOKEN no ambiente seguro.');
 const r=await fetch('https://api.supabase.com'+route,{...init,headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json',...init.headers},redirect:'error',signal:AbortSignal.timeout(45000)});
 const data=await r.json();
 if(!r.ok){mkdirSync(deploymentPrivateDir,{recursive:true,mode:0o700});writeFileSync(deploymentPrivateDir+'/last-error.json',JSON.stringify({status:r.status,route,data}),{mode:0o600});throw new Error('Supabase HTTP '+r.status+'; detalhes guardados no diretório privado de configuração.');}return data;
}
export const managementSQL=(ref:string,query:string,readOnly=false)=>supabaseManagement('/v1/projects/'+encodeURIComponent(ref)+'/database/query',{method:'POST',body:JSON.stringify({query,read_only:readOnly})});
export async function vercelManagement(route:string,init:RequestInit={}){
 const project=getProject(),url=new URL('https://api.vercel.com'+route);url.searchParams.set('teamId',project.orgId);
 const r=await fetch(url,{...init,headers:{Authorization:'Bearer '+process.env.VERCEL_TOKEN,'Content-Type':'application/json',...init.headers},redirect:'error',signal:AbortSignal.timeout(45000)});
 const data=await r.json();if(!r.ok)throw new Error('Vercel HTTP '+r.status+': '+(data.error?.code||'operação não confirmada'));return data;
}
export async function configureSupabase(){
 const project=getProject(),team=await vercelManagement('/v2/teams/'+project.orgId);
 if(team.billing?.plan!=='hobby')throw new Error('Esta configuração gratuita exige o plano Hobby da Vercel. Nenhum plano será alterado automaticamente.');
 const projects=await supabaseManagement('/v1/projects');
 const matches=projects.filter((p:any)=>p.name.toLowerCase().replace(/[^a-z0-9]/g,'')==='00dodark');
 if(matches.length!==1)throw new Error('É necessário selecionar um único projeto Supabase chamado 00 do dark.');
 const target=matches[0],ref=target.id;if(!/^[a-z0-9]+$/.test(ref)||target.status!=='ACTIVE_HEALTHY')throw new Error('O projeto Supabase ainda não está pronto.');
 mkdirSync(deploymentPrivateDir,{recursive:true,mode:0o700});
 const filename=path.join(deploymentPrivateDir,ref+'.json');
 const cached=existsSync(filename)?JSON.parse(readFileSync(filename,'utf8')):null;
 const credentials=cached||{projectRef:ref,role:'dark_app',password:randomBytes(32).toString('base64url'),encryptionKey:randomBytes(32).toString('hex'),cronSecret:randomBytes(32).toString('hex')};
 if(credentials.projectRef!==ref)throw new Error('As credenciais locais pertencem a outro projeto.');
 writeFileSync(filename,JSON.stringify(credentials),{mode:0o600});
 const marker='00 do Dark / '+project.projectId;
 const state=await managementSQL(ref,"SELECT (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='dark') AS schema_owner,(SELECT shobj_description(oid,'pg_authid') FROM pg_roles WHERE rolname='dark_app') AS role_marker,EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dark_app') AS role_exists",true);
 if(state[0].schema_owner&&state[0].schema_owner!=='dark_app')throw new Error('O schema dark já pertence a outro responsável; não foi alterado.');
 if(state[0].role_exists&&state[0].role_marker!==marker)throw new Error('A role dark_app já existe sem a identificação deste projeto; não foi alterada.');
 if(!state[0].role_exists){
  await managementSQL(ref,"SET password_encryption='scram-sha-256';CREATE ROLE dark_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD "+literal(credentials.password)+';COMMENT ON ROLE dark_app IS '+literal(marker)+';');
 }else if(!cached){
  await managementSQL(ref,"SET password_encryption='scram-sha-256';ALTER ROLE dark_app PASSWORD "+literal(credentials.password)+';');
 }
 await managementSQL(ref,'GRANT dark_app TO postgres;CREATE SCHEMA IF NOT EXISTS dark AUTHORIZATION dark_app;REVOKE ALL ON SCHEMA dark FROM PUBLIC;');
 const poolers=await supabaseManagement('/v1/projects/'+ref+'/config/database/pooler');
 const pooler=poolers.find((p:any)=>p.pool_mode==='transaction'&&p.database_type==='PRIMARY')||poolers.find((p:any)=>p.pool_mode==='transaction');
 if(!pooler||!pooler.db_host.endsWith('.pooler.supabase.com'))throw new Error('Pooler de transação não encontrado.');
 const connection=new URL('postgresql://'+pooler.db_host+':'+pooler.db_port+'/'+(pooler.db_name||'postgres'));
 connection.username=credentials.role+'.'+ref;connection.password=credentials.password;connection.searchParams.set('sslmode','verify-full');
 const keys=await supabaseManagement('/v1/projects/'+ref+'/api-keys?reveal=true');
 const secret=keys.find((k:any)=>k.type==='secret'&&k.secret_jwt_template?.role==='service_role'),publishable=keys.find((k:any)=>k.type==='publishable');
 if(!secret?.api_key||!publishable?.api_key)throw new Error('As chaves secret e publishable não estão disponíveis.');
 const existing=await vercelManagement('/v9/projects/'+project.projectId+'/env');
 const envs=new Map<string,any>(existing.envs.filter((e:any)=>e.target?.includes('production')).map((e:any)=>[e.key,e]));
 const values:Record<string,string>={POSTGRES_URL:connection.href,SUPABASE_URL:'https://'+ref+'.supabase.co',SUPABASE_SECRET_KEY:secret.api_key,SUPABASE_PUBLISHABLE_KEY:publishable.api_key,CRON_SECRET:credentials.cronSecret,APP_ORIGIN:'https://'+project.domains[0],DATA_DIR:'/tmp/00-do-dark',DARK_SERVERLESS:'1',DEMO_ENABLED:'false'};
 if(!envs.has('ENCRYPTION_KEY'))values.ENCRYPTION_KEY=credentials.encryptionKey;
 for(const [key,value] of Object.entries(values)){
  const existing=envs.get(key);
  if(existing)await vercelManagement('/v9/projects/'+project.projectId+'/env/'+existing.id,{method:'PATCH',body:JSON.stringify({value,type:'sensitive',target:['production']})});
  else await vercelManagement('/v10/projects/'+project.projectId+'/env',{method:'POST',body:JSON.stringify({key,value,type:'sensitive',target:['production']})});
 }
 writeFileSync('.vercel/supabase.json',JSON.stringify({ref,name:target.name,region:target.region,role:'dark_app',schema:'dark'}));
 console.log('Projeto Supabase existente conectado: role e schema próprios; senha principal preservada. Variáveis protegidas configuradas na Vercel.');return {ref,credentials,project};
}
export async function configureScheduler(ref:string,cronSecret:string,origin:string){
 await managementSQL(ref,'CREATE EXTENSION IF NOT EXISTS pg_cron;CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;');
 const sql="SELECT net.http_post(url := (SELECT value FROM dark.runtime_secrets WHERE key='app-origin') || '/api/internal/tick',headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT value FROM dark.runtime_secrets WHERE key='cron-secret')),body := '{}'::jsonb,timeout_milliseconds := 290000);";
 const query='INSERT INTO dark.runtime_secrets(key,value) VALUES('+literal('cron-secret')+','+literal(cronSecret)+'),('+literal('app-origin')+','+literal(origin)+') ON CONFLICT(key) DO UPDATE SET value=excluded.value;SELECT cron.schedule('+literal('00-do-dark-worker')+','+literal('* * * * *')+','+literal(sql)+') AS id;';
 const result=await managementSQL(ref,query);const id=result.at(-1)?.id;
 if(!id)throw new Error('O banco não confirmou o agendador.');
 await managementSQL(ref,'INSERT INTO dark.runtime_secrets(key,value) VALUES('+literal('scheduler-job')+','+literal(String(id))+') ON CONFLICT(key) DO UPDATE SET value=excluded.value;');
 console.log('Agendador de publicações configurado no banco existente.');return id;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 configureSupabase().catch(error=>{console.error(error.message);process.exitCode=1;});
}

import {execFileSync} from 'node:child_process';
import {packageCloud,cloudSettings} from './cloud-package.ts';
import {configureSupabase,configureScheduler} from './connect-supabase.ts';
import {deployDirectory} from './vercel-upload.ts';
async function main(){
 const {ref,credentials,project}=await configureSupabase(),origin='https://'+project.domains[0];
 execFileSync('npm',['run','build'],{stdio:'inherit'});
 await deployDirectory(packageCloud(false),'application',cloudSettings);
 const health=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(60000)});
 if(!health.ok)throw new Error('A API não iniciou: HTTP '+health.status+'. Verifique os registros da Vercel.');
 const status=await health.json();if(status.status!=='ok'||status.databaseDriver!=='postgresql')throw new Error('Banco persistente não confirmado.');
 await configureScheduler(ref,credentials.cronSecret,origin);
 const setup=await fetch(origin+'/api/internal/setup',{method:'POST',headers:{Authorization:'Bearer '+credentials.cronSecret},signal:AbortSignal.timeout(60000)});
 if(!setup.ok)throw new Error('Armazenamento privado não confirmado: HTTP '+setup.status);
 const final=await(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(60000)})).json();
 if(!final.cloudSetup)throw new Error('A configuração final ainda não foi confirmada.');
 console.log('Aplicação publicada e conectada ao Supabase: '+origin);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

import {execFileSync} from 'node:child_process';
import {packageCloud,cloudSettings} from './cloud-package.ts';
import {configureSupabase,configureScheduler} from './connect-supabase.ts';
import {deployDirectory} from './vercel-upload.ts';

async function main(){
 const {ref,credentials,project}=await configureSupabase();
 const origin='https://'+project.domains[0];
 execFileSync('npm',['run','build:preview'],{stdio:'inherit'});
 await deployDirectory(packageCloud(true),'backend-setup',cloudSettings);
 const health=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(60000)});
 if(!health.ok)throw new Error('A API não iniciou: HTTP '+health.status+'; verifique os registros de execução na Vercel.');
 const status=await health.json();
 if(!health.ok||status.status!=='ok'||status.databaseDriver!=='postgresql')throw new Error('O backend PostgreSQL não passou na verificação de saúde: '+health.status);
 await configureScheduler(ref,credentials.cronSecret,origin);
 const setup=await fetch(origin+'/api/internal/setup',{method:'POST',headers:{Authorization:'Bearer '+credentials.cronSecret},signal:AbortSignal.timeout(60000)});
 if(!setup.ok)throw new Error('O armazenamento privado não foi confirmado: '+setup.status);
 console.log('Banco, armazenamento privado e agendador confirmados.');
 execFileSync('npm',['run','build'],{stdio:'inherit'});
 await deployDirectory(packageCloud(false),'application',cloudSettings);
 const final=await (await fetch(origin+'/api/health',{signal:AbortSignal.timeout(60000)})).json();
 if(final.status!=='ok'||!final.cloudSetup)throw new Error('Publicação aguarda a validação final.');
 console.log('Aplicação publicada e conectada ao Supabase: '+origin);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

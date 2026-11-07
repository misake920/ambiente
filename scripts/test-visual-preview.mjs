import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const origin=process.env.PREVIEW_URL||'http://127.0.0.1:4173';
const directory=process.env.PREVIEW_ARTIFACTS||'artifacts/visual/published-preview';mkdirSync(directory,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:1586,height:992},locale:'pt-BR'}),errors=[],apiRequests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))apiRequests.push(r.url());});
 await page.goto(origin);await page.waitForSelector('.dashboard-page');
 assert(await page.getByRole('status').getByText('PRÉVIA VISUAL',{exact:true}).isVisible());
 const routes=[['dashboard','Visão geral'],['lives','Central de lives'],['interactions','Interações'],['publications','Publicações'],['accounts','Contas']];
 for(const [filename,label] of routes){await page.getByRole('navigation').getByRole('button',{name:new RegExp(label+'$')}).click();await page.waitForTimeout(300);await page.screenshot({path:directory+'/'+filename+'.png'});}
 await page.getByRole('navigation').getByRole('button',{name:/Interações$/}).click();
 await page.getByRole('button',{name:'Testar interação',exact:true}).click();
 await page.getByRole('dialog').waitFor();
 await page.getByRole('dialog').getByRole('button',{name:'Enviar teste para a fila'}).click();
 await page.getByText(/Nenhum dado foi enviado ou salvo/).waitFor();
 await page.goto(origin+'/?page=publicacoes');await page.waitForSelector('.publications-page');
 assert(await page.getByRole('dialog',{name:'Nova publicação'}).isVisible());
 await page.setViewportSize({width:390,height:844});await page.goto(origin);await page.waitForSelector('.dashboard-page');
 assert(await page.getByRole('status').filter({hasText:'PRÉVIA VISUAL'}).isVisible());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.equal(apiRequests.length,0);assert.deepEqual(errors,[]);
 const result={origin,screens:5,mobile:true,mutationsBlocked:true,realAPIRequests:apiRequests.length,errors};
 writeFileSync(directory+'/validation.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();}

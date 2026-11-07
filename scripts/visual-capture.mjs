import { chromium } from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const round=process.argv[2]||'round-1';
const out=`artifacts/visual/${round}`;mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1586,height:992},deviceScaleFactor:1,locale:'pt-BR'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:5173');await page.waitForSelector('.dashboard-page');await page.waitForTimeout(1300);
const routes=[['dashboard','visao-geral'],['lives','lives'],['interactions','interacoes'],['publications','publicacoes'],['accounts','contas']];
const dimensions={};
for(const [name,route] of routes){if(route!=='visao-geral'){await page.goto('http://127.0.0.1:5173/?page='+route);await page.waitForSelector('.page');await page.waitForTimeout(900);}
 if(route==='publicacoes'&&round!=='baseline'&&!await page.getByRole('dialog',{name:'Nova publicação'}).isVisible()){await page.getByRole('button',{name:'Agendar publicação',exact:true}).click();await page.waitForTimeout(300);}
 dimensions[name]=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollHeight:document.documentElement.scrollHeight,sidebar:document.querySelector('.sidebar')?.getBoundingClientRect().toJSON(),heading:document.querySelector('.page-heading')?.getBoundingClientRect().toJSON(),panels:[...document.querySelectorAll('main .panel')].slice(0,8).map(p=>({class:p.className,...p.getBoundingClientRect().toJSON()}))}));
 await page.screenshot({path:`${out}/${name}.png`});
 if(route==='publicacoes'&&round!=='baseline')await page.getByRole('button',{name:'Fechar publicação'}).click();
}
writeFileSync(`${out}/dimensions.json`,JSON.stringify({dimensions,errors},null,2));await browser.close();console.log(JSON.stringify({round,screens:routes.length,errors}));

import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
const origin='http://127.0.0.1:5173',directory='artifacts/review';mkdirSync(directory,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'pt-BR',timezoneId:'America/Fortaleza'}),page=await context.newPage(),errors=[],dimensions={};
 page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.getByRole('heading',{name:'Entrar no estúdio',exact:true}).waitFor();await page.screenshot({path:directory+'/login.png',fullPage:true});
 await page.getByRole('button',{name:'Criar conta',exact:true}).click();await page.getByLabel('Nome',{exact:true}).fill('Estúdio de revisão');await page.getByLabel('E-mail',{exact:true}).fill('review-'+randomBytes(8).toString('hex')+'@example.invalid');await page.getByLabel('Senha',{exact:true}).fill(randomBytes(24).toString('base64url'));await page.getByRole('button',{name:'Criar conta',exact:true}).click();await page.locator('.dashboard-page').waitFor();
 const routes=[['dashboard','Visão geral'],['lives','Central de lives'],['interactions','Interações'],['publications','Publicações'],['accounts','Contas'],['reports','Relatórios'],['settings','Configurações']];
 for(const [name,label]of routes){await page.getByRole('navigation').getByRole('button',{name:new RegExp('^'+label)}).click();await page.evaluate(()=>document.fonts.ready);await page.waitForLoadState('networkidle');await page.waitForTimeout(300);await page.screenshot({path:directory+'/'+name+'.png',fullPage:true});dimensions[name]=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,headingSize:parseFloat(getComputedStyle(document.querySelector('h1')).fontSize)}));assert(dimensions[name].headingSize<=26);assert(dimensions[name].scrollWidth<=1440);}
 await page.setViewportSize({width:390,height:844});
 for(const [name,label]of routes.slice(0,5)){await page.getByRole('button',{name:'Abrir menu'}).click();await page.getByRole('navigation').getByRole('button',{name:new RegExp('^'+label)}).click();await page.waitForLoadState('networkidle');await page.waitForTimeout(300);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:directory+'/'+name+'-mobile.png',fullPage:true});}
 const state=await(await context.request.get(origin+'/api/state')).json();assert.equal(state.stats.revenue,0);assert.equal(state.events.length,0);assert.equal(state.accounts.length,0);assert.equal(state.lives.length,0);assert.deepEqual(errors,[]);
 writeFileSync(directory+'/validation.json',JSON.stringify({localOnly:true,dimensions,mobileScreens:5,emptyAccount:true,errors},null,2));console.log('Capturas locais validadas: '+directory+'; 7 telas desktop, 5 mobile e login; nenhuma atividade fictícia.');
}finally{await browser.close();}

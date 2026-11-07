import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test,expect} from '@playwright/test';
const fixtureDir=mkdtempSync(join(tmpdir(),'dark-browser-'));
const fixture=join(fixtureDir,'dark-fixture.mp4');
test.beforeAll(()=>{execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x5c19a0:s=320x180:d=1','-c:v','libx264','-pix_fmt','yuv420p','-y',fixture]);});
test.afterAll(()=>rmSync(fixtureDir,{recursive:true,force:true}));
async function start(page:any){await page.goto('/');await expect(page.locator('.dashboard-page')).toBeVisible();await page.waitForTimeout(450);}
async function nav(page:any,name:RegExp){await page.getByRole('navigation').getByRole('button',{name}).click();}

test('desktop navigation, real state and notification affordances',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1512,height:1024});await start(page);
 await expect(page.getByText('Demonstração',{exact:true})).toBeVisible();await expect(page.getByText('R$ 1.284,00',{exact:true}).first()).toBeVisible();
 await page.waitForTimeout(1000);await page.screenshot({path:'test-results/dashboard-desktop.png',fullPage:true});
 const routes:[RegExp,string][]=[[/Interações/,'.automation-editor'],[/Publicações/,'.week-calendar'],[/Contas$/,'.account-grid'],[/Central de lives/,'.live-stage'],[/Relatórios/,'.data-table'],[/Configurações/,'.settings-layout']];
 for(const [label,selector] of routes){await nav(page,label);await expect(page.locator(selector)).toBeVisible();}
 await page.getByRole('button',{name:'Abrir notificações'}).click();await expect(page.locator('.notification-dropdown')).toBeVisible();
 expect(errors).toEqual([]);
});

test('rule editor saves, persists and executes a test exactly once',async({page})=>{
 await start(page);let s=await (await page.request.get('/api/state')).json();for(const j of s.jobs.filter((j:any)=>j.type==='interaction'))await page.request.post(`/api/jobs/${j.id}/cancel`);
 await nav(page,/Interações/);await page.getByRole('button',{name:'Nova automação',exact:true}).click();
 await page.getByLabel('Nome da automação').fill('Saudação E2E');await page.getByLabel('Valor mínimo').fill('12');await page.getByRole('button',{name:'Salvar fluxo',exact:true}).click();await expect(page.getByText('Automação salva.',{exact:true})).toBeVisible();
 await page.reload();await page.getByLabel('Selecionar automação').selectOption({label:'Automação: Saudação E2E'});await expect(page.getByRole('button',{name:'Testar interação',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Testar interação',exact:true}).click();await page.getByLabel('Nome do participante').fill('Pessoa E2E');await page.getByRole('button',{name:'Enviar teste para a fila'}).click();
 await expect(page.locator('.interaction-toast')).toBeVisible({timeout:8000});await expect(page.locator('.interaction-toast')).toContainText('Pessoa E2E');
 await expect.poll(async()=>{const state=await (await page.request.get('/api/state')).json();return state.jobs.find((j:any)=>j.data.user==='Pessoa E2E')?.state;},{timeout:12000}).toBe('completed');
 s=await (await page.request.get('/api/state')).json();expect(s.jobs.filter((j:any)=>j.data.user==='Pessoa E2E')).toHaveLength(1);
 await page.screenshot({path:'test-results/interactions-desktop.png',fullPage:true});
});

test('calendar creates a persistent schedule and keeps demo uploads unposted',async({page})=>{
 await start(page);await nav(page,/Publicações/);await page.getByRole('button',{name:'Agendar publicação',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'Nova publicação'});await drawer.getByLabel(/Título/).fill('Conteúdo agendado E2E');await drawer.getByLabel('Descrição',{exact:true}).fill('Uma publicação de teste.');await drawer.getByLabel('Adicionar hashtag',{exact:true}).fill('00doDark');await drawer.getByLabel('Adicionar hashtag',{exact:true}).press('Enter');await drawer.getByRole('button',{name:'Selecionar contas do YouTube',exact:true}).click();await drawer.getByRole('button',{name:'Agendar vídeo',exact:true}).click();await expect(drawer).toBeHidden();
 await page.getByRole('button',{name:'Lista',exact:true}).click();await expect(page.getByText('Conteúdo agendado E2E',{exact:true})).toBeVisible();await page.reload();await page.getByRole('button',{name:'Lista',exact:true}).click();await expect(page.getByText('Conteúdo agendado E2E',{exact:true})).toBeVisible();
 const s=await (await page.request.get('/api/state')).json();const p=s.publications.find((p:any)=>p.title==='Conteúdo agendado E2E');expect(p.hashtags).toContain('00doDark');expect(s.jobs.find((j:any)=>j.data.publicationId===p.id).state).toBe('queued');
});

test('actual media is probed, stored and playable through authorized endpoint',async({page})=>{
 await start(page);await nav(page,/Publicações/);await page.getByRole('button',{name:/Biblioteca de mídia/}).click();await page.locator('input[type=file]').setInputFiles(fixture);await expect(page.getByText('dark-fixture.mp4',{exact:true})).toBeVisible();
 const s=await (await page.request.get('/api/state')).json();const media=s.media.find((m:any)=>m.name==='dark-fixture.mp4');expect(media.width).toBe(320);expect(media.duration).toBeGreaterThan(0);const r=await page.request.get(`/api/media/${media.id}/file`);expect(r.ok()).toBeTruthy();expect(r.headers()['content-type']).toContain('video/mp4');
});

test('mobile navigation, editor controls and calendar do not overflow viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});await start(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 const box=await page.locator('.sidebar').boundingBox();expect(box!.x+box!.width).toBeLessThanOrEqual(1);
 await page.getByRole('button',{name:'Abrir menu'}).click();await nav(page,/Interações/);await page.waitForTimeout(500);await expect(page.locator('.action-inspector')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:'test-results/interactions-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Abrir menu'}).click();await nav(page,/Publicações/);await expect(page.locator('.week-calendar')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

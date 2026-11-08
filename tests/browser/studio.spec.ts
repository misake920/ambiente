import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test,expect} from '@playwright/test';
const fixtureDir=mkdtempSync(join(tmpdir(),'dark-browser-')),fixture=join(fixtureDir,'dark-fixture.mp4');
test.beforeAll(()=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x343039:s=320x180:d=1','-c:v','libx264','-pix_fmt','yuv420p','-y',fixture]));
test.afterAll(()=>rmSync(fixtureDir,{recursive:true,force:true}));
async function start(page:any){
 await page.goto('/');await expect(page.getByRole('heading',{name:'Entrar no estúdio',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Criar conta',exact:true}).click();await page.getByLabel('Nome',{exact:true}).fill('Pessoa de teste');await page.getByLabel('E-mail',{exact:true}).fill('browser-'+Date.now()+'-'+Math.random().toString(16).slice(2)+'@example.invalid');await page.getByLabel('Senha',{exact:true}).fill('browser-test-password-2026');await page.getByRole('button',{name:'Criar conta',exact:true}).click();await expect(page.locator('.dashboard-page')).toBeVisible();
}
async function nav(page:any,name:RegExp){await page.getByRole('navigation').getByRole('button',{name}).click();}
test('starts at login and an actual new account has no fabricated activity',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1512,height:1024});await start(page);
 await expect(page.getByText('R$ 1.284,00',{exact:true})).toHaveCount(0);await expect(page.getByText('Demonstração',{exact:true})).toHaveCount(0);
 const state=await (await page.request.get('/api/state')).json();expect(state.accounts).toHaveLength(0);expect(state.events).toHaveLength(0);expect(state.stats.revenue).toBe(0);expect(state.stats.interactions).toBe(0);expect(state.lives).toHaveLength(0);
 expect(await page.locator('h1').evaluate((h:HTMLElement)=>parseFloat(getComputedStyle(h).fontSize))).toBeLessThanOrEqual(26);
 for(const label of ['Visualizações','Curtidas','Presentes enviados','Valor recebido'])await expect(page.locator('.metrics-grid .metric-label').filter({hasText:label})).toHaveCount(1);
 await expect(page.locator('.metrics-grid .metric > strong')).toHaveText(['—','—','—','R$ 0,00']);
 await expect(page.getByRole('img',{name:/Gráfico neon da receita confirmada/})).toBeVisible();
 await expect(page.locator('.neon-revenue-chart')).toHaveAttribute('data-total','0');
 expect(state.dashboard.revenue.points.every((p:any)=>p.amount===0)).toBeTruthy();expect(state.dashboard.audience.views.value).toBeNull();
 await page.screenshot({path:'test-results/dashboard-professional.png',fullPage:true});
 for(const [label,selector] of [[/Interações/,'.automation-editor'],[/Publicações/,'.week-calendar'],[/Contas e integrações|Contas$/,'.accounts-table-panel'],[/Central de lives/,'.camera-preview'],[/Relatórios/,'.data-table'],[/Configurações/,'.settings-layout']] as [RegExp,string][]){await nav(page,label);await expect(page.locator(selector)).toBeVisible();}
 await page.getByRole('button',{name:'Abrir notificações'}).click();await expect(page.locator('.notification-dropdown')).toBeVisible();expect(errors).toEqual([]);
});
test('dashboard formats supplied live metrics and preserves the actual revenue series',async({page})=>{
 await start(page);const state=await(await page.request.get('/api/state')).json(),now=Date.now();
 const metric=(value:number)=>({value,status:'available',reason:'YouTube · lives ativas',updatedAt:now});
 // Controlled API fixture only in this browser; never writes simulated activity into the app.
 state.dashboard={audience:{views:metric(1234),likes:metric(72),gifts:metric(9),activeLives:1},revenue:{total:5250,updatedAt:now,points:Array.from({length:9},(_,i)=>({at:now-86400000+i*10800000,amount:i*650+(i===8?50:0)}))}};
 await page.route('**/api/state',route=>route.fulfill({json:state}));await page.reload();
 await expect(page.locator('.metrics-grid .metric > strong')).toHaveText(['1.234','72','9','R$ 52,50']);
 await expect(page.locator('.neon-revenue-chart')).toHaveAttribute('data-total','5250');
 await expect(page.locator('.real-revenue .chart-total > strong')).toHaveText('R$ 52,50');
 await expect(page.locator('.neon-revenue-chart .recharts-area-curve')).toHaveAttribute('stroke','#d184ff');
 await expect(page.locator('.neon-revenue-chart filter')).toHaveAttribute('filterUnits','userSpaceOnUse');
 await page.emulateMedia({reducedMotion:'reduce'});expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBeTruthy();
});
test('rule changes persist and an explicit test is executed once without inflating revenue',async({page})=>{
 await start(page);await nav(page,/Interações/);await page.getByRole('button',{name:'Nova automação',exact:true}).click();await page.getByRole('button',{name:'Exibir alerta',exact:true}).click();await page.getByRole('button',{name:'Regra',exact:true}).click();await page.getByLabel('Nome da automação').fill('Saudação E2E');await page.getByLabel(/Valor mínimo/).fill('12');await page.getByRole('button',{name:'Salvar fluxo',exact:true}).click();await expect(page.getByText('Automação salva.',{exact:true})).toBeVisible();await page.reload();await page.getByLabel('Selecionar automação').selectOption({label:'Automação: Saudação E2E'});await page.getByRole('button',{name:'Testar interação',exact:true}).click();await page.getByLabel('Nome do participante').fill('Pessoa E2E');await page.getByRole('button',{name:'Enviar teste para a fila'}).click();await expect(page.locator('.interaction-toast')).toContainText('Pessoa E2E',{timeout:10000});
 await expect.poll(async()=>{const s=await(await page.request.get('/api/state')).json();return s.jobs.find((j:any)=>j.data.user==='Pessoa E2E')?.state;},{timeout:15000}).toBe('completed');
 const state=await(await page.request.get('/api/state')).json();expect(state.stats.revenue).toBe(0);expect(state.stats.interactions).toBe(0);expect(state.jobs.filter((j:any)=>j.data.user==='Pessoa E2E')).toHaveLength(1);
});
test('actual uploaded video can be scheduled to an explicitly manual account',async({page})=>{
 await start(page);const response=await page.request.post('/api/accounts/assisted',{data:{platform:'tiktok',name:'Canal de teste',handle:'@testecanal'}});expect(response.status()).toBe(201);await page.reload();await nav(page,/Publicações/);await expect(page.getByRole('dialog',{name:'Nova publicação'})).toHaveCount(0);await page.getByRole('button',{name:'Agendar publicação',exact:true}).click();const drawer=page.getByRole('dialog',{name:'Nova publicação'});await drawer.getByLabel('Enviar vídeo',{exact:true}).setInputFiles(fixture);await expect(drawer.locator('.upload-zone').getByText('dark-fixture.mp4',{exact:true})).toBeVisible();await drawer.getByLabel('Título',{exact:true}).fill('Vídeo agendado E2E');await drawer.getByLabel('Descrição',{exact:true}).fill('Publicação manual de teste.');await drawer.getByLabel('Adicionar hashtag',{exact:true}).fill('conteudo');await drawer.getByLabel('Adicionar hashtag',{exact:true}).press('Enter');await drawer.getByRole('button',{name:'Selecionar contas do TikTok',exact:true}).click();await drawer.getByRole('button',{name:'Agendar vídeo',exact:true}).click();await expect(drawer).toBeHidden();await page.getByRole('button',{name:'Lista',exact:true}).click();await expect(page.getByText('Vídeo agendado E2E',{exact:true})).toBeVisible();await page.reload();await page.getByRole('button',{name:'Lista',exact:true}).click();await expect(page.getByText('Vídeo agendado E2E',{exact:true})).toBeVisible();const state=await(await page.request.get('/api/state')).json();const p=state.publications.find((p:any)=>p.title==='Vídeo agendado E2E');expect(p.mediaId).toBeTruthy();expect(state.accounts[0].status).toBe('assisted');const media=state.media.find((m:any)=>m.id===p.mediaId);expect(media.width).toBe(320);expect((await page.request.get('/api/media/'+media.id+'/file')).ok()).toBeTruthy();
});
test('OBS overlay executes and acknowledges a test while dashboard does not steal the action',async({page,context})=>{
 await start(page);const state=await(await page.request.get('/api/state')).json();const overlay=await context.newPage();await overlay.goto('/?overlay='+state.settings.overlayToken+'&audio=0');await expect(overlay.locator('.obs-overlay')).toBeVisible();expect(await overlay.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor)).toBe('rgba(0, 0, 0, 0)');await nav(page,/Central de lives/);await expect(page.getByText('Overlay ativo',{exact:true})).toBeVisible({timeout:8000});const rule=state.rules.find((r:any)=>r.trigger==='donation');await page.request.post('/api/events/test',{data:{ruleId:rule.id,kind:'donation',user:'Pessoa OBS',message:'Teste no overlay',amount:1500,confirmed:true}});await expect(overlay.locator('.obs-alert')).toContainText('Pessoa OBS',{timeout:10000});await expect(page.locator('.interaction-toast')).toHaveCount(0);await expect.poll(async()=>{const s=await(await page.request.get('/api/state')).json();return s.jobs.find((j:any)=>j.data.user==='Pessoa OBS')?.state;},{timeout:15000}).toBe('completed');await overlay.close();
});
test('camera permission flow opens a real MediaStream and stops its tracks',async({page})=>{
 await start(page);await nav(page,/Central de lives/);await page.getByRole('button',{name:'Abrir câmera e microfone',exact:true}).click();await expect(page.getByText('Câmera do navegador',{exact:true})).toBeVisible();expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>(v.srcObject as MediaStream)?.getVideoTracks()[0]?.readyState)).toBe('live');await page.getByRole('button',{name:'Microfone ligado',exact:true}).click();await expect(page.getByRole('button',{name:'Microfone desligado',exact:true})).toBeVisible();await page.getByRole('button',{name:'Desligar câmera',exact:true}).click();await expect(page.getByRole('button',{name:'Abrir câmera e microfone',exact:true})).toBeVisible();expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.srcObject)).toBeNull();
});
test('mobile navigation, interaction editor and calendar fit the viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});await start(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:'test-results/dashboard-mobile.png',fullPage:true});for(const name of [/Interações/,/Publicações/,/Contas$/, /Central de lives/]){await page.getByRole('button',{name:'Abrir menu'}).click();await nav(page,name);await expect(page.locator('.sidebar')).not.toHaveClass(/\bopen\b/);await expect.poll(async()=>{const bounds=await page.locator('.sidebar').boundingBox();return bounds!.x+bounds!.width;}).toBeLessThanOrEqual(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();}await page.screenshot({path:'test-results/lives-mobile.png',fullPage:true});
});

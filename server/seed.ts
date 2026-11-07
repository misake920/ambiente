import { randomUUID } from 'node:crypto';
import { db, put, settings } from './db.ts';
import { enqueue } from './engine.ts';
export function initialWorkspace(id: string, demo = false) {
  const config = settings(id);
  put(id, 'rule', { name: 'Doação especial', trigger: 'donation', minAmount: 10, action: 'speak', speech: 'Muito obrigado pela doação, {usuario}! Você fortalece demais o nosso universo! 💜', voice: 'pt-BR', cooldown: 30, duration: 6, enabled: true, priority: 20, command: '', stack: false });
  put(id, 'rule', { name: 'Mensagem da comunidade', trigger: 'chat', minAmount: 0, action: 'speak', speech: '{usuario} disse: {mensagem}', voice: 'pt-BR', cooldown: 10, duration: 6, enabled: true, priority: 1, command: '!fala', stack: false });
  if (!demo) return;
  put(id, 'settings', { ...config, paused: true }, config.id);
  const accounts = [
    ['youtube','Dark Studio TV','@darkstudiotv','connected'], ['youtube','Dark Cortes','@darkcortes','connected'],
    ['tiktok','Dark Studio','@darkstudioofc','connected'], ['tiktok','Dark Games','@darkgamesbr','expired'], ['kwai','Dark Studio Kwai','@darkstudiokwai','connected']
  ].map(([platform,name,handle,status]) => put(id,'account',{ platform,name,handle,status,isDemo:true,permissions:['Leitura','Publicações'],connectedAt:Date.now() }));
  const people = ['Ana', 'Carlos', 'Pedro', 'Mariana', 'Lucas', 'Beatriz', 'Gabriel'];
  const amounts = [1000,2500,5000,20000,39900,30000,30000];
  people.forEach((user,i) => { db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),id,randomUUID(),'livepix','donation',JSON.stringify({user,amount:amounts[i],message:['Valeu pelo conteúdo! 💜','Essa live está incrível!','Bora bater a meta!'][i%3],confirmed:true,status:'approved',isTest:true}),1,Date.now()-(7-i)*3600000); });
  [ ['Ana',1000],['Carlos',2500],['Lucas',1500] ].forEach(([user,amount]) => enqueue(id,'interaction',{name:'Doação especial',user,amount,message:'Valeu pelo conteúdo!',speech:`Muito obrigado, ${user}!`,duration:6,isTest:true,action:'speak',priority:20}));
  const base = new Date();base.setDate(base.getDate()-(base.getDay()+6)%7);
  for(let i=0;i<12;i++) {
    const date = new Date(base); date.setDate(base.getDate()+(i<5?[0,1,2,4,5][i]:i+7));date.setHours([17,19,23,19,1][i%5],0,0,0);
    const p = put(id,'publication',{ title:['Os melhores momentos da live','Novo setup do canal (tour completo)','Live especial: dúvidas da comunidade','Um novo universo começa','Respostas para vocês'][i%5],description:'Momentos incríveis da nossa comunidade. 💜',hashtags:['aovivo','00doDark','highlights'],accountIds:[accounts[[0,2,0,4,2][i%5]].id],scheduleAt:date.toISOString(),timezone:'America/Fortaleza',status:'scheduled',isDemo:true, mediaId:null });
    enqueue(id,'publication',{publicationId:p.id,accountId:accounts[[0,2,0,4,2][i%5]].id,isTest:true},date.getTime());
  }
  [['youtube','Live Meta de doações!',412],['tiktok','Conhecendo o novo setup',286],['kwai','Bate-papo + desafios',137]].forEach(([platform,title,viewers])=>put(id,'live',{platform,title,viewers,scene:'Principal',status:'preview',startedAt:Date.now()-2856000,isDemo:true}));
  put(id,'demo-metrics',{interactions:842,graph:[0,80,140,90,210,190,338,275,375],feed:[{kind:'donation',text:'Ana enviou',highlight:'R$ 10,00'},{kind:'follow',text:'Novo inscrito:',highlight:'@lucasfps'},{kind:'donation',text:'Carlos enviou',highlight:'R$ 25,00'},{kind:'chat',text:'42 interações no chat',highlight:''},{kind:'gift',text:'Pedro enviou',highlight:'R$ 50,00'}]});
  const chat=[['lucasfps','Bora pra meta! 🔥'],['anacarol','Que setup lindo! 💜'],['pedro_game','Essa automação ficou insana!'],['marireis','Manda salve, Dark! 👋'],['caioisz','Já bateu 85% da meta! 🚀'],['vitorzada','Quando vai ter o próximo quiz? 👀'],['ana_silva','Conteúdo sensacional, parabéns! 💜'],['rafaplay','Essa interface tá incrível! ⚡']];
  chat.forEach(([user,message],i)=>db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),id,randomUUID(),'simulator','chat',JSON.stringify({user,message,amount:0,confirmed:true,status:'approved',isTest:true}),1,Date.now()-(8-i)*60000));
}

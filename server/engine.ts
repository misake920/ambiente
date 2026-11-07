import { randomUUID } from 'node:crypto';
import { db, list, put, settings, transaction, log } from './db.ts';
export type IncomingEvent = { externalId: string; provider: string; kind: 'donation' | 'chat' | 'follow'; user: string; message: string; amount: number; confirmed: boolean; isTest: boolean; ruleId?: string };
const normalize = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function moderate(message: string, config: any): string | null {
  if (message.length > config.maxLength) return 'Mensagem excede o limite de caracteres.';
  if (config.blockLinks && /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|gg|io|br)\b)/i.test(message)) return 'Links bloqueados pela moderação.';
  if ((config.blockedWords as string[]).some(word => word.trim() && normalize(message).includes(normalize(word.trim())))) return 'Mensagem bloqueada pelo filtro de palavras.';
  return null;
}
export function enqueue(workspace: string, type: string, data: any, due = Date.now(), state = 'queued') {
  const id = randomUUID(), now = Date.now();
  db.prepare('INSERT INTO jobs(id,workspace,type,state,data,due,created,updated) VALUES(?,?,?,?,?,?,?,?)').run(id, workspace, type, state, JSON.stringify(data), due, now, now);
  return id;
}
export function ingest(workspace: string, input: IncomingEvent) {
  return transaction(() => {
    const found = db.prepare('SELECT id,data FROM events WHERE workspace=? AND provider=? AND external_id=?').get(workspace, input.provider, input.externalId) as any;
    if (found && (JSON.parse(found.data).confirmed || !input.confirmed)) return { duplicate: true, actions: [] as string[] };
    const eventId = found?.id || randomUUID(), now = Date.now(), config = settings(workspace);
    let reason = moderate(input.message, config) || moderate(input.user, { ...config, maxLength: 60 });
    if (input.kind === 'chat') {
      const last=db.prepare("SELECT data FROM events WHERE workspace=? AND provider=? AND kind='chat' AND created>? ORDER BY created DESC LIMIT 30").all(workspace,input.provider,now-1500) as any[];
      if(last.some(e=>normalize(JSON.parse(e.data).user)===normalize(input.user))) reason='Aguarde antes de enviar outra mensagem.';
    }
    const status = reason ? 'blocked' : input.kind === 'donation' && !input.confirmed ? 'pending' : 'approved';
    if(found) db.prepare('UPDATE events SET data=?,is_test=?,created=? WHERE id=? AND workspace=?').run(JSON.stringify({...input,status,reason}),+input.isTest,now,eventId,workspace);
    else db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)').run(eventId, workspace, input.externalId, input.provider, input.kind, JSON.stringify({ ...input, status, reason }), +input.isTest, now);
    if (status !== 'approved') { log(workspace, reason || 'Pagamento pendente: nenhuma ação executada.'); return { duplicate: false, blocked: reason, actions: [] as string[] }; }
    const quiz = list(workspace, 'quiz')[0];
    if (input.kind === 'chat' && quiz?.active && /^![123]$/.test(input.message.trim())) {
      const option = Number(input.message.trim().slice(1))-1;
      const key = `${quiz.round}:${input.provider}:${normalize(input.user)}`;
      if (!list(workspace, 'vote').some(v=>v.key===key)) {
        put(workspace, 'vote', {key}); quiz.votes[option]++;
        put(workspace, 'quiz', quiz, quiz.id);
        if(option===quiz.correct) {
          const score=list(workspace,'score').find(s=>s.name===input.user);
          put(workspace,'score',{name:input.user,points:(score?.points||0)+10},score?.id);
        }
      }
    }
    const localTime=new Intl.DateTimeFormat('en-GB',{timeZone:config.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
    const rules = list(workspace, 'rule').filter(r => (!input.isTest || !input.ruleId || r.id === input.ruleId) && r.enabled && (input.isTest || !r.platform || r.platform==='all' || r.platform===input.provider) && (!r.startTime || !r.endTime || (r.startTime<=r.endTime ? localTime>=r.startTime&&localTime<=r.endTime : localTime>=r.startTime||localTime<=r.endTime)) && r.trigger === input.kind && (input.kind !== 'donation' || input.amount >= Math.round(r.minAmount * 100)) && (!r.command || input.message.startsWith(r.command))).sort((a,b) => b.priority-a.priority);
    const actions: string[] = [];
    for (const rule of rules) {
      const cooldownKey = `${rule.id}:${normalize(input.user)}`;
      const last = list(workspace, 'cooldown').find(c => c.key === cooldownKey);
      if (last && now-last.at < rule.cooldown*1000) { log(workspace, `Cooldown aplicado: ${rule.name}.`); continue; }
      put(workspace, 'cooldown', { key: cooldownKey, at: now }, last?.id);
      actions.push(enqueue(workspace, 'interaction', {
        eventId, ruleId: rule.id, name: rule.name, user: input.user, amount: input.amount,
        message: input.message, action: rule.action, speech: rule.speech.replaceAll('{usuario}', input.user).replaceAll('{mensagem}', input.message),
        scene: rule.scene || 'Quiz', duration: Math.min(15, Math.max(3, rule.duration || 6)), isTest: input.isTest, priority: rule.priority,
      }, now, config.manualApproval ? 'awaiting_approval' : 'queued'));
      if (!rule.stack) break;
    }
    log(workspace, `${input.isTest ? '[Teste] ' : ''}${input.kind === 'donation' ? 'Doação recebida' : 'Mensagem recebida'}: ${input.user}. ${actions.length} ação(ões) na fila.`);
    return { duplicate: false, actions };
  });
}
export function recoverJobs(now = Date.now()) {
  const expired = db.prepare("SELECT * FROM jobs WHERE state='running' AND lease<?").all(now) as any[];
  for (const job of expired) {
    const state = job.type === 'publication' ? 'needs_review' : 'expired';
    db.prepare('UPDATE jobs SET state=?, error=?, updated=? WHERE id=?').run(state, job.type === 'publication' ? 'Resultado remoto incerto. Verifique na plataforma antes de tentar novamente.' : 'Overlay não confirmou a execução. A ação não será repetida automaticamente.', now, job.id);
  }
}
export function claimInteraction(workspace: string) {
  return transaction(() => {
    const config = settings(workspace);
    if (config.paused || config.emergency) return null;
    if (db.prepare("SELECT id FROM jobs WHERE workspace=? AND type='interaction' AND state='running'").get(workspace)) return null;
    // Aging guarantees that chat actions eventually outrank recent high-priority donations.
    const row = db.prepare("SELECT * FROM jobs WHERE workspace=? AND type='interaction' AND state='queued' AND due<=? ORDER BY (json_extract(data,'$.priority') + (? - created)/1000.0) DESC, created LIMIT 1").get(workspace, Date.now(), Date.now()) as any;
    if (!row) return null;
    const data = JSON.parse(row.data), now = Date.now();
    db.prepare("UPDATE jobs SET state='running', attempts=attempts+1, lease=?, claimed_by=NULL, updated=? WHERE id=? AND state='queued'").run(now + (data.duration+15)*1000, now, row.id);
    if(data.action==='scene') put(workspace,'settings',{scene:data.scene},config.id);
    if(data.action==='quiz') put(workspace,'settings',{scene:'Quiz'},config.id);
    return { ...row, state: 'running', data };
  });
}

import { Heart, Coffee, Sparkles, Volume2, VolumeX } from 'lucide-react';
import Countdown from './Countdown';
import { money } from '../api';
import type { Context, Obj } from '../types';
export function Stage({ctx,overlay=false,scene:externalScene,action:externalAction}:{ctx?:Context;overlay?:boolean;scene?:string;action?:Obj|null}){
 const scene=externalScene||ctx?.state.settings.scene||'Principal',action=externalAction||ctx?.action;
 const config=ctx?.state.settings;
 const art=config?.character==='custom'&&config.characterArtworkId?'/api/artworks/'+config.characterArtworkId+'/file':'/assets/darkbot-reference.png';
 const hue=config?.character==='nova'?'-40deg':config?.character==='pulse'?'25deg':'0deg';
 const revenue=ctx?.state.stats.revenue||0;
 return <div className={'live-stage '+(overlay?'overlay-stage ':'')+(action?'reacting':'')+(ctx?.me.demo?' demo-stage':'')}>
 {scene==='Intervalo'?<div className="scene-message"><Coffee size={48}/><h2>Uma pausa. Já voltamos.</h2><p>O universo continua por aqui. 💜</p></div>:<><img className="stage-background" src={art} style={{filter:`hue-rotate(${hue})`,objectFit:config?.character==='custom'?'contain':'cover'}} alt="Personagem do estúdio"/><div className="stage-gradient"/>{scene==='Quiz'?<div className="stage-quiz"><Sparkles size={24}/><h3>{ctx?.state.quiz?.question || 'Hora do quiz!'}</h3>{ctx?.state.quiz ? <div className="stage-quiz-options">{ctx.state.quiz.options.map((o:string,i:number)=><div key={i}><b>!{i+1}</b>{o}<small>{ctx.state.quiz!.votes[i]} votos</small></div>)}</div> : <p>Abra um quiz na central para a comunidade participar.</p>}</div>:<div className="stage-brand"><span>CONEXÃO ALÉM DA TELA</span><strong>Seu universo.<br/>Sua comunidade.</strong><small>00 do Dark Studio</small></div>}</>}
 <Countdown at={config?.countdownAt}/><div className="stage-top"><span className="preview-label"><i/>{overlay?'OVERLAY':'PRÉVIA DO ESTÚDIO'}</span>{ctx&&<button className="icon-button glass" aria-label={ctx.audio?'Silenciar prévia':'Ativar som da prévia'} onClick={()=>ctx.setAudio(!ctx.audio)}>{ctx.audio?<Volume2 size={17}/>:<VolumeX size={17}/>}</button>}</div>
 {!action&&ctx?.me.demo&&<div className="donation-alert reference-demo-alert" title="Alerta demonstrativo; nenhum pagamento real recebido"><Heart size={31} fill="currentColor"/><div><strong>Ana enviou R$ 10,00</strong><p>Valeu pelo conteúdo! 💜</p></div></div>}{action&&<div className={'donation-alert alert-position-'+(config?.overlayPosition||'top-left')} style={{borderColor:config?.overlayColor}}><Heart size={30} fill="currentColor"/><div><strong>{action.data.user} {action.data.amount?`enviou ${money(action.data.amount)}`:'participou do chat'}</strong><p>{action.data.message||action.data.speech}</p><small>{action.data.isTest?'EVENTO DE TESTE':'INTERAÇÃO'}</small></div></div>}
 {config&&<div className="stage-goal"><div><strong>{config.goalName}</strong><span>{money(config.goal)}</span></div><div className="progress"><i style={{width:`${Math.min(100,revenue/config.goal*100)}%`}}/></div><small>{money(revenue)} <span>({Math.round(revenue/config.goal*100)}%)</span></small></div>}
 {action?.data.action==='animation'&&<div className="celebration-particles">{Array.from({length:16},(_,i)=><i key={i} style={{left:(i*6.6)+'%',animationDelay:(i%5)*.13+'s',background:i%2?'#c365ff':'#f7c4ff'}}/>)}</div>}<span className="stage-watermark">00 / DARK</span>
 </div>
}

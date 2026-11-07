import { useEffect, useRef } from 'react';
import type { Obj } from '../types';
import { post } from '../api';
export function usePlayer(job:Obj|null, audio:boolean, token:string|null,onActive:(v:Obj|null)=>void) {
 const consumer=useRef(crypto.randomUUID()),seen=useRef(new Set<string>()),enabled=useRef(audio),sound=useRef<AudioContext|null>(null);
 const stopSound=()=>{const context=sound.current;sound.current=null;if(context&&context.state!=='closed')void context.close().catch(()=>{});};
 enabled.current=audio;
 useEffect(()=>{
  if(!job||seen.current.has(job.id))return;seen.current.add(job.id);
  let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined,soundTimer:ReturnType<typeof setTimeout>|undefined;
  const base=token?'/overlay/'+token:'/player';
  void post(base+'/claim',{id:job.id,consumer:consumer.current}).then(()=>{
   if(cancelled)return;onActive(job);
   if(job.data.action==='sound'&&enabled.current&&'AudioContext' in window){const context=new AudioContext();sound.current=context;[523.25,659.25,783.99].forEach((freq,i)=>{const osc=context.createOscillator(),gain=context.createGain();osc.frequency.value=freq;gain.gain.setValueAtTime(0,context.currentTime);gain.gain.linearRampToValueAtTime(.12,context.currentTime+i*.12+.01);gain.gain.exponentialRampToValueAtTime(.001,context.currentTime+i*.12+.35);osc.connect(gain);gain.connect(context.destination);osc.start(context.currentTime+i*.12);osc.stop(context.currentTime+i*.12+.4);});soundTimer=setTimeout(stopSound,1000);}
   if(job.data.action==='speak'&&enabled.current&&'speechSynthesis' in window) {
    const utterance=new SpeechSynthesisUtterance(job.data.speech);utterance.lang='pt-BR';
    const voice=window.speechSynthesis.getVoices().find(v=>v.lang.toLowerCase()==='pt-br');if(voice)utterance.voice=voice;
    window.speechSynthesis.speak(utterance);
   }
   timer=setTimeout(()=>{window.speechSynthesis?.cancel();onActive(null);void post(base+'/ack',{id:job.id,consumer:consumer.current}).catch(()=>{});},job.data.duration*1000);
  }).catch(()=>{});
  return()=>{cancelled=true;if(timer)clearTimeout(timer);if(soundTimer)clearTimeout(soundTimer);stopSound();window.speechSynthesis?.cancel();onActive(null);};
 },[job?.id,token]);
 useEffect(()=>{if(!audio){stopSound();window.speechSynthesis?.cancel();}},[audio]);
}

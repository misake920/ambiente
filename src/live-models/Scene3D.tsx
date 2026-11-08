import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type {LiveModel,ModelState,ModelAction} from '../../shared/live-models';

type Props={model:LiveModel;state:ModelState;reaction?:ModelAction|null;animate?:boolean;onReady?:(ok:boolean)=>void};
export default function Scene3D({model,state,reaction,animate=true,onReady}:Props){
 const host=useRef<HTMLDivElement>(null),latest=useRef(reaction),ready=useRef(onReady),[failed,setFailed]=useState(false);latest.current=reaction||state.lastAction;ready.current=onReady;
 useEffect(()=>{
  const el=host.current;if(!el)return;setFailed(false);let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});}catch{setFailed(true);ready.current?.(false);return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.3;
  renderer.shadowMap.enabled=animate;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.domElement.setAttribute('aria-label','Cenário 3D '+model.name);el.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(37,1,.1,80);scene.fog=new THREE.FogExp2('#10091e',.035);camera.position.set(5,4.3,7.4);camera.lookAt(0,1.15,0);
  const ambient=new THREE.HemisphereLight('#ead5ff','#171025',2.2);scene.add(ambient);
  const key=new THREE.DirectionalLight('#f3d6ff',3.5);key.position.set(4,8,5);key.castShadow=animate;key.shadow.mapSize.set(1024,1024);scene.add(key);
  const rim=new THREE.PointLight(model.color,25,15);rim.position.set(-3,3,-2);scene.add(rim);
  const fill=new THREE.PointLight(model.accent,18,12);fill.position.set(3,2,2);scene.add(fill);
  const materials:THREE.Material[]=[],geometries:THREE.BufferGeometry[]=[];
  const mat=(color:string,glow=0)=>{const m=new THREE.MeshStandardMaterial({color,roughness:.3,metalness:.4,emissive:color,emissiveIntensity:glow});materials.push(m);return m;};
  const purple=mat(model.color,.16),accent=mat(model.accent,.3),black=mat('#110b23'),metal=mat('#342448'),light=mat(model.accent,2),white=mat('#eadfff');
  const mesh=(geometry:THREE.BufferGeometry,material:THREE.Material,parent:THREE.Object3D,x=0,y=0,z=0)=>{geometries.push(geometry);const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
  const box=(x:number,y:number,z:number,material:THREE.Material,parent:THREE.Object3D,px=0,py=0,pz=0)=>mesh(new RoundedBoxGeometry(x,y,z,3,.09),material,parent,px,py,pz);
  const world=new THREE.Group();scene.add(world);
  mesh(new THREE.CylinderGeometry(2.65,2.85,.2,72),metal,world,0,-.18,0);
  const ring=mesh(new THREE.TorusGeometry(2.65,.035,8,100),light,world,0,-.06,0);ring.rotation.x=Math.PI/2;
  const grid=new THREE.GridHelper(5,12,model.color,'#352047');grid.position.y=-.055;world.add(grid);
  const actor=new THREE.Group();world.add(actor);const moving:THREE.Object3D[]=[];
  function robot(parent:THREE.Object3D,color:THREE.Material,x=0,scale=1){
   const group=new THREE.Group();group.position.x=x;group.scale.setScalar(scale);parent.add(group);
   box(.95,.85,.7,color,group,0,.9,0);box(1.4,1.05,.95,color,group,0,1.9,0);box(1.15,.72,.13,black,group,0,1.94,.48);
   for(const sign of [-1,1]){
    const eye=mesh(new THREE.TorusGeometry(.13,.035,8,24,Math.PI),light,group,sign*.28,1.92,.56);eye.rotation.z=0;
    box(.28,.7,.33,color,group,sign*.7,.95,0);box(.3,.32,.55,metal,group,sign*.27,.27,.12);
    const ear=mesh(new THREE.TorusGeometry(.27,.09,12,28),accent,group,sign*.77,1.91,0);ear.rotation.y=Math.PI/2;
   }
   mesh(new THREE.TorusGeometry(.16,.035,8,30),light,group,0,1,.38);return group;
  }
  if(model.scene==='bot')robot(actor,purple);
  if(model.scene==='arena'){robot(actor,purple,-1.05,.75);robot(actor,accent,1.05,.75);box(.1,1.6,.1,light,actor,0,.8,-.6);}
  if(model.scene==='rocket'){
   mesh(new THREE.CylinderGeometry(.43,.5,1.8,36),white,actor,0,1.65,0);mesh(new THREE.ConeGeometry(.44,.9,36),purple,actor,0,3,0);
   const window=mesh(new THREE.TorusGeometry(.22,.07,14,36),accent,actor,0,2,.45);mesh(new THREE.SphereGeometry(.19,24,16),black,actor,0,2,.45);window.rotation.z=.3;
   for(let i=0;i<3;i++){const a=i*Math.PI*2/3;const fin=box(.22,.75,.6,purple,actor,Math.sin(a)*.48,.9,Math.cos(a)*.48);fin.rotation.y=a;}
   const flame=mesh(new THREE.ConeGeometry(.28,.8,24),mat('#ffb66a',1.5),actor,0,.4,0);flame.rotation.z=Math.PI;moving.push(flame);
  }
  if(model.scene==='tower'){
   for(let k=0;k<3;k++){const x=(k-1)*1.15;box(.95,.25,.95,metal,actor,x,.12,0);}
   const count=Math.min(36,state.objects+3);
   for(let i=0;i<count;i++){const k=i%3,level=Math.floor(i/3);box(.88,.38,.88,i%3===1?accent:purple,actor,(k-1)*1.15,.44+level*.42,0);box(.5,.035,.04,light,actor,(k-1)*1.15,.48+level*.42,.45);}
   if(count>18){actor.scale.setScalar(.75);camera.lookAt(0,1.9,0);}
  }
  if(model.scene==='garden'){
   mesh(new THREE.CylinderGeometry(2.3,2.35,.25,50),mat('#263c32'),actor,0,.04,0);
   for(let i=0;i<Math.min(25,state.objects+3);i++){
    const a=i*2.399,r=.4+Math.sqrt(i)*.32,g=new THREE.Group();g.position.set(Math.cos(a)*r,.2,Math.sin(a)*r);actor.add(g);
    mesh(new THREE.CylinderGeometry(.025,.04,.65,8),mat('#4da67f'),g,0,.32,0);mesh(new THREE.SphereGeometry(.12,12,12),light,g,0,.72,0);
    for(let j=0;j<5;j++){const a=j*Math.PI*2/5,p=mesh(new THREE.SphereGeometry(.15,12,12),i%2?purple:accent,g,Math.cos(a)*.16,.71,Math.sin(a)*.16);p.scale.y=.5;}
    moving.push(g);
   }
  }
  if(model.scene==='orbit'){
   mesh(new THREE.SphereGeometry(.85,40,32),purple,actor,0,1.45,0);
   for(let i=0;i<3;i++){const r=mesh(new THREE.TorusGeometry(1.4+i*.3,.018,8,96),i===1?light:accent,actor,0,1.45,0);r.rotation.set(.7+i*.3,.3,i*.5);moving.push(r);}
   for(let i=0;i<Math.min(28,state.objects+4);i++){const a=i*2.399,r=1.3+(i%3)*.3;mesh(new THREE.IcosahedronGeometry(.08+(i%3)*.03),light,actor,Math.cos(a)*r,1.5+Math.sin(a*2)*.6,Math.sin(a)*r);}
  }
  const particles=new THREE.Group();world.add(particles);
  for(let i=0;i<30;i++){const a=i*2.399,r=1.5+(i%7)*.38;mesh(new THREE.IcosahedronGeometry(.025+(i%3)*.012),i%2?light:accent,particles,Math.sin(a)*r,.5+(i%9)*.4,Math.cos(a)*r);}
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');let frame=0,previous=0;
  const draw=(time:number)=>{
   if(animate)frame=requestAnimationFrame(draw);if(animate&&time-previous<32)return;previous=time;
   const t=reduce.matches?0:time/1000,action=latest.current,age=action?(Date.now()-action.at)/1000:99,reacting=age>=0&&age<3&&!reduce.matches;
   actor.rotation.y=animate?Math.sin(t*.3)*.08:0;actor.position.y=0;actor.rotation.z=0;
   particles.rotation.y=t*.07;
   if(model.scene==='arena')actor.children.slice(0,2).forEach(g=>g.position.y=0);
   if(model.scene==='orbit')actor.rotation.y=t*.12;
   if(model.scene==='garden')moving.forEach((g,i)=>g.rotation.z=Math.sin(t*1.2+i)*.035);
   if(model.scene==='rocket'&&moving[0])moving[0].scale.y=.8+Math.sin(t*9)*.15;
   if(reacting&&action){
    const a=action.action;
    if(['jump','boost','build','plant'].includes(a))actor.position.y=Math.abs(Math.sin(age*Math.PI*2))*.65;
    if(['spin','dance','celebrate','nova','bloom','water','star'].includes(a))actor.rotation.y+=age*Math.PI*2;
    if(a==='dance')actor.rotation.z=Math.sin(age*12)*.2;
    if(a==='launch')actor.position.y=Math.sin(age/3*Math.PI)*4;
    if(a==='purple'||a==='green'){const member=actor.children[a==='purple'?0:1];if(member)member.position.y=Math.abs(Math.sin(age*8))*.35;}
    particles.scale.setScalar(1+Math.sin(age*Math.PI/3)*.4);rim.intensity=35;
   }else{particles.scale.setScalar(1);rim.intensity=25;}
   renderer.render(scene,camera);
  };
  const resize=()=>{const w=el.clientWidth,h=el.clientHeight;if(w&&h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();if(!animate)draw(0);}};
  const observer=new ResizeObserver(resize);observer.observe(el);resize();if(animate)frame=requestAnimationFrame(draw);ready.current?.(true);
  const lost=(e:Event)=>{e.preventDefault();setFailed(true);ready.current?.(false);};renderer.domElement.addEventListener('webglcontextlost',lost);
  return()=>{cancelAnimationFrame(frame);observer.disconnect();renderer.domElement.removeEventListener('webglcontextlost',lost);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());grid.geometry.dispose();(grid.material as THREE.Material).dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
 },[model.scene,model.color,model.accent,state.objects,animate]);
 return <div ref={host} className="model-canvas">{failed&&<div className="model-gpu-error"><strong>Renderização 3D indisponível</strong><span>Ative a aceleração de hardware no navegador ou no OBS e reabra esta cena.</span></div>}</div>;
}

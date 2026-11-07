export const renderServiceName='00-do-dark-api';
export const renderRepository='https://github.com/misake920/ambiente';
export function renderServicePayload(ownerId:string){
 if(!/^(tea|usr)-[a-zA-Z0-9]+$/.test(ownerId))throw new Error('Selecione um workspace Render válido.');
 return {type:'web_service',name:renderServiceName,ownerId,repo:renderRepository,branch:'main',autoDeployTrigger:'off',envVars:[
  {key:'NODE_ENV',value:'production'},{key:'PORT',value:'3001'},{key:'DATA_DIR',value:'/data'},
  {key:'APP_ORIGIN',value:'https://00-do-dark.vercel.app'},{key:'TRUST_PROXY',value:'1'},
  {key:'DEMO_ENABLED',value:'true'},{key:'REGISTRATION_ENABLED',value:'true'},
 ],serviceDetails:{runtime:'docker',plan:'starter',region:'ohio',numInstances:1,healthCheckPath:'/api/health',envSpecificDetails:{dockerfilePath:'./Dockerfile',dockerContext:'.'},disk:{name:'dark-data',mountPath:'/data',sizeGB:1}}};
}

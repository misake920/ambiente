import type {Request,Response} from 'express';
process.env.DARK_SERVERLESS='1';process.env.NODE_ENV??='production';process.env.DATA_DIR??='/tmp/00-do-dark';process.env.TRUST_PROXY??='1';
export default async function handler(req:Request,res:Response){
 const storage=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.VITE_PUBLIC_SUPABASE_URL;
 const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
 const publicKey=process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.VITE_PUBLIC_SUPABASE_ANON_KEY;
 if(!process.env.POSTGRES_URL||!process.env.ENCRYPTION_KEY||!process.env.CRON_SECRET||!storage||!secret||!publicKey||!process.env.APP_ORIGIN){
  res.setHeader('Cache-Control','no-store');res.status(503).json({status:'unavailable',error:'O backend gratuito aguarda a vinculação do banco e armazenamento. Nenhuma conta ou arquivo será salvo em disco temporário.'});return;
 }
 const {app}=await import('../server/app.ts');return app(req,res);
}

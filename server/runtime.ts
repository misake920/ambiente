export const serverless=process.env.VERCEL==='1'||process.env.DARK_SERVERLESS==='1';
export const cloudMediaLimit=50*1024*1024;
export const cloudStorageBudget=900*1024*1024;

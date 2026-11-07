import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/browser',timeout:30000,fullyParallel:false,workers:1,use:{baseURL:process.env.TEST_BASE_URL||'http://127.0.0.1:5173',headless:true,launchOptions:{executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']},trace:'retain-on-failure',screenshot:'only-on-failure'},reporter:'list'});

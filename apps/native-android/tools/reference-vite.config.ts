import base from './vite.config';
import {fileURLToPath} from 'node:url';
export default {...base,base:'/web/',publicDir:false,cacheDir:'artifacts/cache/native-p1-reference',
  build:{outDir:fileURLToPath(new URL('../app/build/generated/web-reference/web',import.meta.url)),emptyOutDir:true,
    rollupOptions:{input:[fileURLToPath(new URL('./reference.html',import.meta.url)),fileURLToPath(new URL('./p2-reference.html',import.meta.url))]}}};

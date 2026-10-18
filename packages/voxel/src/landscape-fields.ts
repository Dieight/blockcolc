const clamp=(n:number)=>Math.max(0,Math.min(1,n));
export function smooth(a:number,b:number,n:number){const t=clamp((n-a)/(b-a));return t*t*(3-2*t);}
export function random(seed:number,x:number,z:number){let n=Math.imul(x,374761393)^Math.imul(z,668265263)^seed;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967296;}
export function noise(seed:number,x:number,z:number,scale:number){const u=x/scale,v=z/scale,ix=Math.floor(u),iz=Math.floor(v),a=smooth(0,1,u-ix),b=smooth(0,1,v-iz);
  return(random(seed,ix,iz)*(1-a)+random(seed,ix+1,iz)*a)*(1-b)+(random(seed,ix,iz+1)*(1-a)+random(seed,ix+1,iz+1)*a)*b;}

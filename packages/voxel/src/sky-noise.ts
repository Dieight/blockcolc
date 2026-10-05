/** CPU reference of the shared shader's continuous 3-D lattice field, used to
 * check angular seams and lattice boundaries without image-tolerance guesses. */
export function skyNoise3(x:number,y:number,z:number):number {
  const hash=(x:number,y:number,z:number)=>{
    const n=Math.sin((x+z*59)*127.1+(y+z*7)*311.7)*43758.5453;
    return n-Math.floor(n);
  };
  const fade=(t:number)=>t*t*t*(t*(t*6-15)+10),mix=(a:number,b:number,t:number)=>a+(b-a)*t;
  const a=Math.floor(x),b=Math.floor(y),c=Math.floor(z),u=fade(x-a),v=fade(y-b),w=fade(z-c);
  return mix(mix(mix(hash(a,b,c),hash(a+1,b,c),u),mix(hash(a,b+1,c),hash(a+1,b+1,c),u),v),
    mix(mix(hash(a,b,c+1),hash(a+1,b,c+1),u),mix(hash(a,b+1,c+1),hash(a+1,b+1,c+1),u),v),w);
}

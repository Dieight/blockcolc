// Shared by the isolated browser producer and Node export runner. IDs also
// bound filenames; never accept arbitrary styles or paths from a page query.
export const P1_FIXTURES=Object.freeze([
  Object.freeze({name:'ocean',style:'ocean-island'}),
  Object.freeze({name:'coast',style:'mosaic-coast'}),
  Object.freeze({name:'valley',style:'natural-valley'}),
  Object.freeze({name:'floating',style:'classic-island'}),
]);

export function fixtureForStyle(style,count=25){
  const fixture=P1_FIXTURES.find(row=>row.style===style);
  if(!fixture||count!==25)throw Error('P1 fixture outside frozen scope');
  return fixture;
}

export function exportArguments(argv){
  const inventoryOnly=argv.at(-1)==='--inventory-only';if(inventoryOnly)argv=argv.slice(0,-1);
  const [output,profile='day',assets='original',scope='main',jar,...extra]=argv;
  if(!output||extra.length||!['day','night','rain','snow'].includes(profile)
    ||!['original','mc263'].includes(assets)||!['main','all'].includes(scope)
    ||(assets==='mc263'?typeof jar!=='string'||!jar.toLowerCase().endsWith('.jar'):jar!==undefined))
    throw Error('Usage: export-world.mjs <new-directory> [day|night|rain|snow] [original|mc263] [main|all] [explicit-client.jar]');
  return {output,profile,assets,jar,inventoryOnly,fixtures:P1_FIXTURES.slice(0,scope==='all'?4:2)};
}

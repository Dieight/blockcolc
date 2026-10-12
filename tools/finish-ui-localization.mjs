import fs from 'node:fs';
for(const file of fs.readdirSync('apps/web/src',{recursive:true}).filter(file=>file.endsWith('.tsx')&&!file.includes('.test.')&&!file.startsWith('review'))){
  const path='apps/web/src/'+file,source=fs.readFileSync(path,'utf8');
  let output=source.replaceAll(".toLocaleDateString('zh-CN'",'.toLocaleDateString(appLocale()')
    .replaceAll(".toLocaleTimeString('zh-CN'",'.toLocaleTimeString(appLocale()')
    .replaceAll(".toLocaleString('zh-CN'",'.toLocaleString(appLocale()')
    .replaceAll("Intl.DateTimeFormat('zh-CN'",'Intl.DateTimeFormat(appLocale()');
  if(output!==source)output=output.replace('import { t,','import { t, appLocale,');
  if(file==='ui\\AchievementsPanel.tsx'||file==='ui/AchievementsPanel.tsx')output=output.replaceAll('{entry.title}','{t(entry.title)}').replaceAll('{entry.description}','{t(entry.description)}').replaceAll('{entry.unit}','{t(entry.unit)}').replaceAll('entry.target, entry.unit','entry.target, t(entry.unit)');
  if(output!==source)fs.writeFileSync(path,output);
}

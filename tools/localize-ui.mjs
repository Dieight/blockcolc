import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {EN} from '../apps/web/src/messages-en.ts';

// One-time source migration, not a DOM translator or a runtime source scanner.
const root=path.resolve('apps/web/src');
const files=fs.readdirSync(root,{recursive:true}).filter(file=>file.endsWith('.tsx')&&!file.includes('.test.')&&!file.startsWith('review'));
const han=/[\u3400-\u9fff]/;
const inventory=new Map();
for(const file of files){
  const filename=path.join(root,file),source=fs.readFileSync(filename,'utf8');
  const ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),edits=[];
  if(process.argv.includes('--fix-memos')){
    const visitMemo=node=>{if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useMemo'&&node.arguments.length===2&&/(^|[^\w])t\(/.test(node.arguments[0].getText(ast))&&ts.isArrayLiteralExpression(node.arguments[1])){const deps=node.arguments[1];edits.push([deps.end-1,deps.end-1,`${deps.elements.length?',':''}appLanguage()`]);}ts.forEachChild(node,visitMemo);};
    visitMemo(ast);if(edits.length){let output=source;for(const [start,end,text] of edits.sort((a,b)=>b[0]-a[0]))output=output.slice(0,start)+text+output.slice(end);output=output.replace('import { t, useI18n }','import { t, useI18n, appLanguage }');fs.writeFileSync(filename,output);}continue;
  }
  if(process.argv.includes('--restore-constants')){
    const visitConstant=node=>{
      if(ts.isCallExpression(node)&&node.expression.getText(ast)==='t'){
        let parent=node.parent,inside=false;
        while(parent){if(ts.isFunctionLike(parent)){inside=true;break;}parent=parent.parent;}
        if(!inside&&node.arguments.length===1)edits.push([node.getStart(ast),node.end,node.arguments[0].getText(ast)]);
      }
      ts.forEachChild(node,visitConstant);
    };
    visitConstant(ast);let output=source;for(const [start,end,text] of edits.sort((a,b)=>b[0]-a[0]))output=output.slice(0,start)+text+output.slice(end);if(edits.length)fs.writeFileSync(filename,output);continue;
  }
  let changed=false,hook=false;
  const replace=(node,text)=>{edits.push([node.getStart(ast),node.end,text]);changed=true;};
  const eligible=node=>{
    if((ts.isPropertyAssignment(node.parent)||ts.isPropertySignature(node.parent))&&node.parent.name===node)return false;
    for(let parent=node.parent;parent;parent=parent.parent){
      if(ts.isTypeNode(parent)||ts.isImportDeclaration(parent))return false;
      if(ts.isCallExpression(parent)&&ts.isPropertyAccessExpression(parent.expression)&&/^(includes|startsWith|endsWith|replace|replaceAll|split|indexOf|lastIndexOf|match|test|querySelector|querySelectorAll|closest|matches|getItem|setItem|removeItem|setAttribute|addEventListener|removeEventListener|log|warn|error)$/.test(parent.expression.name.text))return false;
      if(ts.isBinaryExpression(parent)&&[ts.SyntaxKind.EqualsEqualsToken,ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsToken,ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.operatorToken.kind))return false;
      if(ts.isJsxAttribute(parent)&&/^(key|className|id|data-)/.test(parent.name.getText(ast)))return false;
    }
    return true;
  };
  const add=(text)=>{if(!inventory.has(text))inventory.set(text,[]);inventory.get(text).push(file);};
  const visit=node=>{
    if(ts.isJsxText(node)&&han.test(node.text)){
      const text=node.text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).join(' ');add(text);
      if(process.argv.includes('--apply'))replace(node,`{t(${JSON.stringify(text)})}`);
      return;
    }
    if(ts.isStringLiteral(node)&&han.test(node.text)&&eligible(node)){
      add(node.text);
      if(process.argv.includes('--apply'))replace(node,ts.isJsxAttribute(node.parent)?`{t(${JSON.stringify(node.text)})}`:`t(${JSON.stringify(node.text)})`);
      return;
    }
    if(ts.isTemplateExpression(node)&&han.test(node.getText(ast))&&eligible(node)){
      let key=node.head.text;const values=[];
      for(const span of node.templateSpans){key+=`{${values.length}}${span.literal.text}`;values.push(span.expression.getText(ast));}
      add(key);
      if(process.argv.includes('--apply'))replace(node,`t(${JSON.stringify(key)}, ${values.join(', ')})`);
      // Nested template expressions are left intact to avoid overlapping edits.
      return;
    }
    if(process.argv.includes('--apply')&&ts.isFunctionDeclaration(node)&&node.name&&/^[A-Z]/.test(node.name.text)&&node.body&&node.getText(ast).includes('<')){
      edits.push([node.body.getStart(ast)+1,node.body.getStart(ast)+1,'\n  useI18n();']);hook=true;
    }
    ts.forEachChild(node,visit);
  };
  visit(ast);
  if(process.argv.includes('--apply')&&changed){
    const relative=path.relative(path.dirname(filename),path.join(root,'i18n')).replaceAll('\\','/');
    let output=source;for(const [start,end,text] of edits.sort((a,b)=>b[0]-a[0]))output=output.slice(0,start)+text+output.slice(end);
    output=`import { t${hook?', useI18n':''} } from '${relative.startsWith('.')?relative:`./${relative}`}';\n`+output;
    fs.writeFileSync(filename,output);
  }
}
if(!process.argv.includes('--apply')){
  const selected=process.argv.filter(value=>!value.startsWith('--'))[2];
  for(const [key,files] of inventory)if((!process.argv.includes('--missing')||!EN[key])&&(!selected||files.some(file=>file.includes(selected))))console.log(JSON.stringify(key));
}

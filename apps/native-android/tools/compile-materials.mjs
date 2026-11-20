import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const compiler=process.argv[2],output=process.argv[3];if(!compiler||!output)throw Error('matc and output directory required');
const root=fileURLToPath(new URL('../',import.meta.url));
const version=execFileSync(compiler,['--version'],{encoding:'utf8'}).trim();
if(version!=='56')throw Error('Filament 1.56.0 requires matc 56, got '+version);
const compilerSha256=createHash('sha256').update(await readFile(compiler)).digest('hex');
const template=await readFile(path.join(root,'world-filament/src/main/materials/instanced.mat.in'),'utf8');
const sourceColor=await readFile(path.join(root,'world-filament/src/main/materials/source-color.glsl.in'),'utf8');
let field=await readFile(path.join(root,'world-filament/src/main/materials/night-field.glsl.in'),'utf8');
field=field.replace(/^uniform .*;\r?\n/gm,'');
for(const [source,target] of Object.entries({bcSkyStars:'skyStars',bcSkyGalaxy:'skyGalaxy',bcSkyAurora:'skyAurora',bcSkyDensity:'skyDensity',bcSkyColdDirection:'skyColdDirection',bcSkyGalaxyNormal:'skyGalaxyNormal'}))
  field=field.replaceAll(source,'materialParams.'+target);
field=field.replaceAll('bcSkyTime','sourceSkyTime()').replaceAll('bcSkyMeteor','sourceSkyMeteor()');
await mkdir(output,{recursive:true});
for(const shading of ['lit','unlit'])for(const blending of ['opaque','masked','transparent','additive']) {
  if(shading==='lit'&&blending==='additive')continue; // No source lit-additive material has been reviewed.
  const name=shading+'-'+blending;
  // Three NormalBlending attenuates diffuse, specular and emissive by alpha.
  // Filament transparent leaves specular unattenuated; fade matches that source.
  const code=template.replaceAll('@NAME@',name).replaceAll('@SHADING@',shading).replaceAll('@BLENDING@',blending==='transparent'?'fade':blending==='additive'?'add':blending)
    .replaceAll('@STORM_COLOR@','float3(0.693871761,0.799102738,1.0)')
    .replaceAll('@NIGHT_FIELD@',field)
    .replaceAll('@SOURCE_COLOR@',sourceColor)
    .replaceAll('@SOURCE_NORMAL@','material.sourceNormal = float4(getCustom0().xyz, 0.0);')
    .replaceAll('@ALPHA@',['transparent','additive'].includes(blending)?'base.rgb *= base.a;':'')
    .replaceAll('@NORMAL@',shading==='lit'?'material.worldNormal = normalize(transpose(inverse(mat3(transform))) * material.worldNormal) * materialParams.normalSign;':'')
    .replaceAll('@FOG_VARIANT_BEGIN@',shading==='lit'?'#if defined(VARIANT_HAS_DIRECTIONAL_LIGHTING) || defined(VARIANT_HAS_DYNAMIC_LIGHTING)':'')
    .replaceAll('@FOG_VARIANT_END@',shading==='lit'?'#endif':'')
    .replaceAll('@FOG_EVALUATION@',shading==='lit'?`
            float4 lit = evaluateMaterial(material);
            float alpha = ${blending==='transparent'?'lit.a':'1.0'};
            float3 fogged = sourceFinish(lit.rgb * multiplier, alpha, fogFactor);
            // Make the outer engine evaluation emission-only, not a second
            // contribution from its BRDF. addEmissive supplies alpha once.
            material.baseColor = float4(0.0,0.0,0.0,alpha);
            material.reflectance = 0.0; material.metallic = 0.0;
            material.emissive = float4(fogged / max(alpha, 0.000001), 0.0);`:`
            material.baseColor.rgb = sourceFinish(material.baseColor.rgb * multiplier, ${['transparent','additive'].includes(blending)?'base.a':'1.0'}, fogFactor);`)
    .replaceAll('@LIGHTING@',shading==='lit'?`material.roughness = materialParams.roughness; material.metallic = materialParams.metallic;
        if (materialParams.motionKind == 6) {
            float r = variable_sourceAtlas.w;
            material.roughness = mix(1.0, r < 0.5 ? 0.9 : r < 1.5 ? 0.96 : r < 2.5 ? 0.82 : r < 3.5 ? 0.5 : 0.16, materialParams.motionData[1].z);
            material.metallic = r > 2.5 && r < 3.5 ? 0.32 : 0.0;
        }
        // The public view-vector getter returns mediump on mobile. Half-float
        // quantization turns the fine directional star field into large blobs.
        float3 incident = normalize(getWorldPosition() - getWorldCameraPosition());
        float3 reflection = sourceReflection(material.roughness, incident, getWorldNormalVector());
        // Filament addEmissive applies alpha once; do not premultiply it twice.
        material.emissive = float4((materialParams.emissive + reflection)${blending==='additive'?' * base.a':''}, 0.0);`:'');
  const source=path.join(output,name+'.mat');await writeFile(source,code);
  execFileSync(compiler,['-p','mobile','-a','opengl','-a','vulkan','--optimize-size','-o',path.join(output,name+'.filamat'),source],{stdio:'inherit'});
}
for(const name of ['terminal-color','color-probe','bloom-bright','bloom-blur','glass-blur','glass-compose']) {
  const source=path.join(output,name+'.mat');
  await writeFile(source,(await readFile(path.join(root,'world-filament/src/main/materials',name+'.mat'),'utf8')).replaceAll('@SOURCE_COLOR@',sourceColor));
  execFileSync(compiler,['-p','mobile','-a','opengl','-a','vulkan','--optimize-size','-o',path.join(output,name+'.filamat'),source],{stdio:'inherit'});
}
const paper=await readFile(path.join(root,'world-filament/src/main/materials/paper.mat.in'),'utf8');
for(const blend of ['opaque','fade']) {
  const source=path.join(output,'paper-'+blend+'.mat');
  await writeFile(source,paper.replaceAll('@BLEND@',blend).replaceAll('@DEPTH@',String(blend==='opaque')));
  execFileSync(compiler,['-p','mobile','-a','opengl','-a','vulkan','--optimize-size','-o',path.join(output,'paper-'+blend+'.filamat'),source],{stdio:'inherit'});
}
await writeFile(path.join(output,'compiler.json'),JSON.stringify({filament:'1.56.0',version,compilerSha256,backends:['opengl','vulkan']},null,2));

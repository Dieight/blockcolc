import base from '../../../spikes/world-closeup/vite.config';
export default {...base,server:{...base.server,port:42039},
  cacheDir:'artifacts/cache/native-p1-vite',
  plugins:[...base.plugins!,{name:'p1-preparation-tick',enforce:'pre' as const,transform(source:string,id:string){
    const normalized=id.replaceAll('\\','/');
    if(normalized.endsWith('/packages/voxel/src/scenery-instance-culling.ts')) {
      const anchor='    mesh.castShadow = false;';
      if(source.split(anchor).length!==2)throw Error('P1 full source hook changed');
      return source.replace(anchor,'    (mesh as any).__nativeShadow = shadow;\n'+anchor);
    }
    if(!normalized.endsWith('/packages/voxel/src/renderer.ts'))return;
    const anchor='closeup={scene,camera,renderer,root:rotatableWorldRoot,sky:skySpectacle,';
    if(source.split(anchor).length!==2)throw Error('P1 preparation hook changed');
    const animationAnchor='controller.setActiveTextureIndices(referencedAnimatedTextureIndices.get(pageIndex) ?? []);';
    if(source.split(animationAnchor).length!==2)throw Error('P1 atlas activity hook changed');
    source=source.replace(animationAnchor,'{controller.setActiveTextureIndices(referencedAnimatedTextureIndices.get(pageIndex) ?? []); (controller as any).__p1Indices=[...(referencedAnimatedTextureIndices.get(pageIndex) ?? [])];}');
    return source.replace(anchor,anchor+`atlas:()=>activeResourcePack?{atlas:activeResourcePack.atlas,active:atlasAnimationControllers.map(c=>(c as any)?.__p1Indices??[])}:null,
      ownerConstruction:(projectId:string,progress:number)=>{
        if(projectId!=='complex-0'||!Number.isInteger(progress)||progress<0||progress>10000)throw Error('Only the admitted P2 owner may be derived');
        const previous=positionedWorlds.find(world=>world.projectId===projectId);if(!previous)throw Error('P2 owner placement missing');
        const otherRoots=buildingGroup.children.filter(root=>root.userData.projectId!==projectId).map(root=>root.uuid);
        for(const root of [...buildingGroup.children].filter(root=>root.userData.projectId===projectId)){
          root.traverse(child=>{fallbackOcclusionMeshes.delete(child as any);staticSurfaceOcclusionMeshes.delete(child as any);cutoutShadowMeshes.delete(child as any);});
          retireBuildingRoot(root as THREE.Group);
        }
        liveBuildings.delete(projectId);constructionOutlines.length=0;emissiveMaterials=[];
        const next={...previous,buildingCompletionBasisPoints:progress,isMonument:progress===10000};
        addBuilding(next,[],null);
        positionedWorlds=positionedWorlds.map(world=>world.projectId===projectId?next:world);
        lastWorlds=lastWorlds.map(world=>world.projectId===projectId?{...world,buildingCompletionBasisPoints:progress,isMonument:progress===10000}:world);
        updateLighting(new Date(),true);
        const root=buildingGroup.children.find(root=>root.userData.projectId===projectId);if(!root)throw Error('P2 owner was not built');
        cacheStaticTransformTree(root);scene.updateMatrixWorld(true);
        if(JSON.stringify(otherRoots)!==JSON.stringify(buildingGroup.children.filter(root=>root.userData.projectId!==projectId).map(root=>root.uuid)))throw Error('Owner derivation changed another root');
        return {sourceOperation:'production addBuilding at unchanged P2 placement, not full setWorlds',otherRoots:otherRoots.length};
      },
      probeView:(ratio:number,pitch:number,azimuth:number)=>{
        cameraDistance=ratio*fittedDistance;cameraPitch=targetCameraPitch=pitch;cameraAzimuth=targetCameraAzimuth=azimuth;updateCamera();requestRender();},
      frozenCamera:(input:any)=>{
        if(!input||input.position.length!==3||input.target.length!==3||![...input.position,...input.target,input.fittedDistance,input.fov].every(Number.isFinite))throw Error('Invalid frozen reference camera');
        cameraTarget.fromArray(input.target);const delta=new THREE.Vector3().fromArray(input.position).sub(cameraTarget);
        cameraDistance=delta.length();fittedDistance=input.fittedDistance;camera.fov=input.fov;
        cameraPitch=targetCameraPitch=Math.asin(delta.y/cameraDistance);cameraAzimuth=targetCameraAzimuth=Math.atan2(delta.z,delta.x);
        updateCamera();syncPrecipitationField(true);requestRender();},
      probeMoon:()=>{
        if(!moonSprite.visible)throw Error('Source moon is not visible');
        const eye=camera.position.clone(),point=moonSprite.getWorldPosition(new THREE.Vector3());
        cameraTarget.copy(point);cameraDistance=eye.distanceTo(point);camera.fov=10;
        cameraPitch=targetCameraPitch=Math.asin((eye.y-point.y)/cameraDistance);
        cameraAzimuth=targetCameraAzimuth=Math.atan2(eye.z-point.z,eye.x-point.x);updateCamera();requestRender();},
      renderStats:()=>({totalRenderedFrames,qualityTier,pixelRatio:renderer.getPixelRatio()}),
      animals:()=>animals,
      animalActivityScale:()=>currentLighting.nightFactor>.55?.45:currentWeather.kind==='clear'?1:.7,
      probeAnimal:(kind:string)=>{
        const candidates=(animals as any)?.community?.agents.filter((a:any)=>a.kind===kind);
        const a=kind==='land'?candidates?.at(-1):candidates?.[0];if(!a)throw Error('No source animal kind '+kind);
        cameraTarget.set(a.position.x,a.position.y+.35,a.position.z);cameraDistance=8;camera.fov=34;
        cameraPitch=targetCameraPitch=Math.PI/3;cameraAzimuth=targetCameraAzimuth=Math.PI/4;updateCamera();syncPrecipitationField(true);requestRender();},
      animalSnapshot:()=>{const community=(animals as any)?.community;return community?{count:community.agents.length,time:community.time,
        agents:community.agents.map((a:any)=>({id:a.id,kind:a.kind,species:a.species,activity:a.activity,position:[a.position.x,a.position.y,a.position.z],heading:a.heading,traveled:a.traveled})),
        rigCounts:['parts','faces','contacts','ripples'].map(k=>(animals as any).models[k].count)}:null;},
      precipitation:()=>({schema:1,rootRotationY:rotatableWorldRoot.rotation.y,
        bounds:[visibilityBounds.min.x,visibilityBounds.max.x,visibilityBounds.min.z,visibilityBounds.max.z],
        framing:[contentBounds.getSize(new THREE.Vector3()).x,contentBounds.getSize(new THREE.Vector3()).z],
        groundY:[precipitationGround.minY,precipitationGround.maxY],qualityDensity:QUALITY_PROFILES.high.weatherDensity,
        animations:[rainAnimation,snowAnimation].filter(Boolean).map((a:any)=>({kind:a===rainAnimation?'rain':'snow',
          capacity:a.particles.length,referenceCount:a.referenceCount,baseCrossSection:a.baseCrossSection??.36,
          activeCount:a.mesh.count,elapsedMs:a.elapsedMs,size:a.uniforms.size.value,field:{...a.field}}))}),
      cameraVolume:()=>({schema:1,framingRadius:Math.max(6,contentBounds.getSize(new THREE.Vector3()).length()/2),
        visibility:[visibilityBounds.min.toArray(),visibilityBounds.max.toArray()],skyBaseRadius:SKY_RADIUS,
        skyFarRatio:SKY_FAR_CLIP_RATIO,starRadiusRatio:STAR_RADIUS_RATIO,starNearMargin:STAR_NEAR_CLIP_MARGIN,
        sourceSkyRadius:skyGroup.scale.x*SKY_RADIUS}),
      prepareTick:()=>updateAmbientMotion(performance.now()),
      pipeline:()=>({bloom:{...lightingPostProcessor.getDiagnostics(),
        threshold:(lightingPostProcessor as any).brightMaterial.uniforms.uThreshold.value,
        softKnee:(lightingPostProcessor as any).brightMaterial.uniforms.uSoftKnee.value,
        strength:(lightingPostProcessor as any).compositeMaterial.uniforms.uBloomStrength.value},
        worldColor:{...(worldColorCompositor as any).preference}}),
      fullBatch:(mesh:any)=>{const b=(sceneryInstanceCulling as any).batches.get(mesh);return b?{...b,castShadow:mesh.__nativeShadow?.castShadow??mesh.castShadow}:null;},`);
  }}],optimizeDeps:{entries:['apps/native-android/tools/world.html']}};

import * as THREE from 'three';

/** Snapshot actual renderer values, not a second local-time approximation. */
export function captureEnvironment(scene,renderer,pipeline=null){
  scene.updateMatrixWorld(true);
  const lights=[],gaps=[];
  scene.traverse(object=>{
    if(!object.isLight)return;
    let visible=true;for(let p=object;p;p=p.parent)visible&&=p.visible;
    const position=object.getWorldPosition(new THREE.Vector3());
    const entry={type:object.type,visible,intensity:object.intensity,color:object.color.toArray(),position:position.toArray()};
    if(object.isDirectionalLight){
      entry.direction=object.target.getWorldPosition(new THREE.Vector3()).sub(position).normalize().toArray();
      entry.castShadow=object.castShadow;
      const s=object.shadow,c=s.camera;
      entry.shadow={mapSize:s.mapSize.toArray(),bias:s.bias,normalBias:s.normalBias,radius:s.radius,
        near:c.near,far:c.far,left:c.left,right:c.right,top:c.top,bottom:c.bottom};
    }else if(object.isHemisphereLight){
      entry.direction=position.clone().normalize().toArray();entry.groundColor=object.groundColor.toArray();
    }else if(object.isPointLight){
      entry.distance=object.distance;entry.decay=object.decay;entry.castShadow=object.castShadow;
    }else gaps.push('light-model:'+object.type);
    lights.push(entry);
  });
  const fog=scene.fog;
  if(fog&&!fog.isFog)gaps.push('fog-model:'+fog.type);
  return {schema:1,colorSpace:'linear-srgb',outputColorSpace:renderer.outputColorSpace,
    toneMapping:renderer.toneMapping,exposure:renderer.toneMappingExposure,
    clearColor:renderer.getClearColor(new THREE.Color()).toArray(),clearAlpha:renderer.getClearAlpha(),
    shadow:{enabled:renderer.shadowMap.enabled,type:renderer.shadowMap.type,autoUpdate:renderer.shadowMap.autoUpdate},
    lights,fog:fog?{type:fog.isFog?'linear':'unported',color:fog.color.toArray(),near:fog.near,far:fog.far}:null,
    pipeline,gaps};
}

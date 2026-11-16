import * as THREE from 'three';
import {captureMaterialProgram} from './material-program.mjs';
import {fullMapSource} from './full-map-source.mjs';

/** Read-only adapters for source points / billboards. No original object is
 * reparented, and native rendering still uses real instanced draw packets. */
export function completeSceneSource(hook){
  const source=fullMapSource(hook.fullBatch,{includeDistant:true}),converted=new WeakMap(),plane=new THREE.PlaneGeometry(1,1);
  function billboard(object){
    if(converted.has(object))return converted.get(object);
    const input=object.material;
    if(input.rotation)throw Error('Unreviewed source billboard rotation');
    if(object.isPoints&&(input.sizeAttenuation||input.map))throw Error('Unreviewed source point rasterization');
    const m=new THREE.MeshBasicMaterial({color:input.color,opacity:input.opacity,transparent:input.transparent,
      map:input.map??null,depthWrite:input.depthWrite,depthTest:input.depthTest,side:THREE.DoubleSide,fog:input.fog,
      alphaTest:input.alphaTest,blending:input.blending});
    m.colorWrite=input.colorWrite;m.depthFunc=input.depthFunc;
    m.userData.nativeBillboard=object.isPoints?2:1;m.userData.nativePointSize=object.isPoints?input.size:0;
    m.userData.nativeBillboardCenter=object.isSprite?object.center.toArray():[.5,.5];
    m.userData.nativeSourceType=input.type;m.userData.nativeProgram=captureMaterialProgram(input,hook.renderer);
    const positions=object.isPoints?object.geometry.getAttribute('position'):null;
    if(positions&&object.geometry.index)throw Error('Unreviewed indexed source points');
    const begin=positions?object.geometry.drawRange.start:0;
    const count=positions?Math.max(0,Math.min(positions.count,begin+object.geometry.drawRange.count)-begin):1;
    if(!Number.isInteger(begin)||begin<0||positions&&begin>positions.count||!Number.isInteger(count))throw Error('Invalid source point drawRange');
    const mesh=new THREE.InstancedMesh(plane,m,count),matrix=new THREE.Matrix4();
    for(let i=0;i<count;i++){
      matrix.identity();if(positions)matrix.makeTranslation(positions.getX(begin+i),positions.getY(begin+i),positions.getZ(begin+i));mesh.setMatrixAt(i,matrix);
    }
    mesh.matrixWorld.copy(object.matrixWorld);mesh.parent=object.parent;mesh.name=object.name;
    mesh.castShadow=false;mesh.receiveShadow=false;mesh.visible=object.visible;
    converted.set(object,mesh);return mesh;
  }
  return {
    selectObject(object){
      let included=false;for(let p=object;p;p=p.parent)if(p===hook.root||p.name==='layeredSky')included=true;
      return included&&source.selectObject(object);
    },
    resolveMesh(object){return object.isSprite||object.isPoints?billboard(object):source.resolveMesh(object);},
    dispose(){plane.dispose();},
  };
}

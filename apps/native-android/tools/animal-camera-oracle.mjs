import * as THREE from 'three';

// Independent Three frustum, not a transcription of the native plane test.
export function animalCameraOracle(){
  const rows=[];
  for(const [index,view]of [
    {eye:[0,15,35],target:[0,0,0],fov:60,aspect:.75,near:.1,far:100},
    {eye:[343,386,343],target:[0,6.12,0],fov:34,aspect:.75,near:219,far:1450},
    {eye:[-30,5,7],target:[12,1,-15],fov:90,aspect:1.6,near:2,far:180},
    {eye:[0,100,1],target:[0,0,0],fov:34,aspect:.75,near:1,far:600}
  ].entries()){
    const camera=new THREE.PerspectiveCamera(view.fov,view.aspect,view.near,view.far);
    camera.position.fromArray(view.eye);camera.lookAt(...view.target);camera.updateMatrixWorld(true);
    const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const forward=new THREE.Vector3();camera.getWorldDirection(forward);
    const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
    for(const depth of [-10,view.near,view.near+2,10,50,view.far,view.far+3]){
      const halfHeight=depth*Math.tan(view.fov*Math.PI/360),halfWidth=halfHeight*view.aspect;
      for(const sx of [-1.3,-1.01,-.99,0,.99,1.01,1.3])for(const sy of [-1.02,0,1.02])for(const kind of ['land','bird']){
        const center=camera.position.clone().addScaledVector(forward,depth).addScaledVector(right,sx*halfWidth).addScaledVector(up,sy*halfHeight);
        const position=center.clone();position.y-=.7;
        rows.push({...view,cameraIndex:index,kind,position:position.toArray(),visible:frustum.intersectsSphere(new THREE.Sphere(center,kind==='bird'?1.5:1.8))});
      }
    }
  }
  return rows;
}

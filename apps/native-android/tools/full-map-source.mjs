import * as THREE from 'three';

/** A read-only view of the producer's original instance buffers. Do not turn
 * camera-compacted color draws plus their depth copies into a second world. */
export function fullMapSource(lookupBatch,{includeDistant=false}={}) {
  return {
    selectObject(object) {
      for(let parent=object;parent;parent=parent.parent) {
        if(parent.userData.sceneryShadowCopy)return false;
        if(parent.name==='distant'&&parent.parent?.userData.sceneryObject&&!includeDistant)return false;
        if(!parent.visible&&!((parent.name==='full'||includeDistant&&parent.name==='distant')&&parent.parent?.userData.sceneryObject))return false;
      }
      return true;
    },
    resolveMesh(object) {
      const batch=lookupBatch(object);
      if(!batch)return object;
      const view=Object.create(object),geometry=Object.create(object.geometry);
      geometry.attributes={...object.geometry.attributes};
      view.geometry=geometry;view.count=batch.count;view.castShadow=batch.castShadow;
      for(const {attribute,source} of batch.copies) {
        const copy=new THREE.InstancedBufferAttribute(source,attribute.itemSize,attribute.normalized,attribute.meshPerAttribute);
        if(attribute===object.instanceMatrix)view.instanceMatrix=copy;
        else if(attribute===object.instanceColor)view.instanceColor=copy;
        else {
          const name=Object.keys(object.geometry.attributes).find(key=>object.geometry.attributes[key]===attribute);
          if(!name)throw Error('Source instance channel not found');
          geometry.attributes[name]=copy;
        }
      }
      return view;
    },
  };
}

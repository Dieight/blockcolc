import * as THREE from 'three';
import type {AnimalAgent} from './animal-behavior';

/** Original cuboid models and pixels, independent of a Minecraft client/pack. */
function pixels(face=false):THREE.DataTexture {
  const data=new Uint8Array(16*16*4);
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const i=(y*16+x)*4,value=face?(y>=8&&y<12&&(x>=2&&x<5||x>=11&&x<14)?35:255):225+(x*17+y*7+x*y)%31;
    data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
  }
  const texture=new THREE.DataTexture(data,16,16);texture.colorSpace=THREE.SRGBColorSpace;
  texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}
const colors={sheep:0xe6dfc9,cow:0x615047,pig:0xe1a09a,horse:0x986d4c,silverfish:0x9bbcb5,salmon:0xbe6d58,tropicalfish:0xe1a245,gull:0xf0e9d3,swallow:0x424b59,finch:0xb8965a};
export class AnimalModels {
  readonly root=new THREE.Group();readonly parts:THREE.InstancedMesh;readonly faces:THREE.InstancedMesh;
  readonly contacts:THREE.InstancedMesh;readonly ripples:THREE.InstancedMesh;
  private readonly textures=[pixels(),pixels(true)];private readonly dummy=new THREE.Object3D();private readonly base=new THREE.Matrix4();
  private readonly head=new THREE.Matrix4();private readonly pivot=new THREE.Matrix4();private readonly matrix=new THREE.Matrix4();private readonly color=new THREE.Color();
  private part=0;private face=0;private contact=0;private ripple=0;
  private partIds:number[]=[];private faceIds:number[]=[];
  constructor(){
    this.parts=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({map:this.textures[0],roughness:1}),1536);
    this.faces=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshStandardMaterial({map:this.textures[1],roughness:1}),64);
    // The contact patch is deliberately small and square-edged, not a new
    // whole-world shadow-map render for every moving foot.
    this.contacts=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0x2b3527,transparent:true,opacity:.16,depthWrite:false}),32);
    const ring=new THREE.RingGeometry(.6,.76,12).rotateX(-Math.PI/2);
    this.ripples=new THREE.InstancedMesh(ring,new THREE.MeshBasicMaterial({color:0xd9f6ec,transparent:true,opacity:.35,depthWrite:false,side:THREE.DoubleSide}),32);
    this.root.name='world-animals';
    for(const mesh of [this.parts,this.faces,this.contacts,this.ripples]){
      mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.receiveShadow=true;this.root.add(mesh);
      // Allocate the shader feature before initial scene compilation, rather
      // than compiling the instanced-color variant when wildlife first appears.
      mesh.setColorAt(0,new THREE.Color(0xffffff));
    }
    this.parts.name='animal-cuboids';this.faces.name='animal-faces';this.contacts.name='animal-contact-shadows';this.ripples.name='animal-water-ripples';
  }
  private put(mesh:THREE.InstancedMesh,index:number,parent:THREE.Matrix4,x:number,y:number,z:number,sx:number,sy:number,sz:number,color:number,rx=0,ry=0,rz=0){
    this.dummy.position.set(x,y,z);this.dummy.rotation.set(rx,ry,rz);this.dummy.scale.set(sx,sy,sz);this.dummy.updateMatrix();
    this.matrix.multiplyMatrices(parent,this.dummy.matrix);mesh.setMatrixAt(index,this.matrix);mesh.setColorAt(index,this.color.setHex(color));
  }
  update(agents:readonly AnimalAgent[],time:number,visible?:ReadonlySet<number>){
    this.part=this.face=this.contact=this.ripple=0;this.partIds=[];this.faceIds=[];
    const cube=(a:AnimalAgent,p:THREE.Matrix4,x:number,y:number,z:number,sx:number,sy:number,sz:number,c:number,rx=0,ry=0,rz=0)=>{
      this.put(this.parts,this.part++,p,x,y,z,sx,sy,sz,c,rx,ry,rz);this.partIds.push(a.id);
    };
    for(const a of agents){
      if(visible&&!visible.has(a.id))continue;
      const c=colors[a.species],moving=['walk','swim','jump','takeoff','fly','land'].includes(a.activity),response=a.response>0;
      const pulse=response?Math.sin((1.3-a.response)*5):0,gait=a.traveled*6;
      this.dummy.position.set(a.position.x,a.position.y,a.position.z);this.dummy.rotation.set(a.kind==='fish'&&a.activity==='jump'?-Math.cos((a.route?.t??0)*Math.PI)*.6:0,a.heading,0);this.dummy.scale.setScalar(1);this.dummy.updateMatrix();this.base.copy(this.dummy.matrix);
      if(a.kind==='land'){
        const horse=a.species==='horse',cow=a.species==='cow',pig=a.species==='pig';
        const bodyY=horse?1.22:cow?.91:pig?.55:.76,bodyZ=horse?1.3:cow?1.05:pig?.9:.75,bodyW=horse?.72:cow?.76:pig?.62:.64;
        const rest=a.activity==='rest'?.16:0,bob=moving?Math.abs(Math.sin(gait))*.025:Math.sin(time+a.phase)*.008;
        cube(a,this.base,0,bodyY-rest+bob,-.05,bodyW,horse?.72:cow?.65:pig?.48:.58,bodyZ,c);
        if(cow){cube(a,this.base,.015,bodyY+.03,-.2,bodyW+.015,.34,.3,0xe6e0cd);cube(a,this.base,-.1,bodyY+.3,.2,.33,.02,.3,0xd9d5c6);}
        if(horse){cube(a,this.base,0,1.62,.48,.32,.75,.4,c, -.22);cube(a,this.base,0,1.72,.27,.12,.66,.15,0x493d31, -.22);cube(a,this.base,0,1,-.77,.15,.75,.16,0x483c30,.28);}
        const lower=a.activity==='graze'&&!response?.38:0;
        this.head.copy(this.base).multiply(this.pivot.makeTranslation(0,(horse?2:cow?1.25:pig?.69:1.03)-lower-rest+bob,bodyZ*.46));
        this.head.multiply(this.pivot.makeRotationY(response?pulse*.38:Math.sin(time*.6+a.phase)*.1));
        const headW=horse?.33:cow?.45:pig?.45:.43,headH=horse?.48:cow?.45:pig?.36:.45;
        cube(a,this.head,0,0,.11,headW,headH,.43,c);
        cube(a,this.head,0,-.08,.36,headW*.8,.18,.15,pig?0xc7797e:cow?0xb7a38c:horse?0xc1a27f:0xb5a18a);
        for(const side of [-1,1]){
          cube(a,this.head,side*(headW/2+.065),horse?.27:.02,.08,horse?.13:.16,horse?.3:.1,.17,c,0,0,side*(.12+(response?Math.sin(time*17)*.35:0)));
          if(cow)cube(a,this.head,side*.2,.28,.06,.07,.18,.08,0xd8cfac);
        }
        this.put(this.faces,this.face++,this.head,0,.06,.332,headW*.94,headH*.6,1,pig?0xe5ada0:0xe8dec7);this.faceIds.push(a.id);
        const legs=horse?.84:cow?.59:pig?.3:.48;
        for(let leg=0;leg<4;leg++){
          const x=(leg%2?1:-1)*bodyW*.32,z=leg<2?-bodyZ*.32:bodyZ*.32;
          this.head.copy(this.base).multiply(this.pivot.makeTranslation(x,legs-rest,z));
          this.head.multiply(this.pivot.makeRotationX(moving?Math.sin(gait+(leg===0||leg===3?0:Math.PI))*.4:0));
          cube(a,this.head,0,-(legs-rest)/2,0,horse?.14:.15,legs-rest,.16,pig?c:0xa58a71);
          cube(a,this.head,0,-(legs-rest)+.04,.025,.16,.12,.19,0x514b40);
        }
        if(!horse)cube(a,this.base,0,bodyY-.05,-bodyZ*.58,.12,.27,.12,c,0,0,Math.sin(time*2+a.phase)*.18);
        const floor=a.walker?.navigator.world.query({minX:a.position.x-.01,maxX:a.position.x+.01,minZ:a.position.z-.01,maxZ:a.position.z+.01})
          .filter(s=>!s.water&&s.maxY<=a.position.y+.025).reduce((n,s)=>Math.max(n,s.maxY),-2048)??a.position.y;
        if(floor>-2048)this.put(this.contacts,this.contact++,this.base,0,floor-a.position.y+.015,0,bodyW*.95,1,bodyZ*.9,0xffffff);
      }else if(a.kind==='fish'){
        const tail=Math.sin(time*(response?24:10)+a.phase)*.55;
        cube(a,this.base,0,0,0,.21,.32,.68,c,0,Math.sin(time*4+a.phase)*.06);
        cube(a,this.base,0,.02,-.42,.06,.38,.24,a.species==='tropicalfish'?0xe5dbb9:c,0,tail);
        cube(a,this.base,0,.2,-.06,.045,.18,.27,0x6f9081,0,tail*.3);
        cube(a,this.base,0,-.13,.08,.36,.04,.24,c,0,tail*.3);
        if(a.species==='tropicalfish')cube(a,this.base,0,0,.04,.216,.33,.12,0xede8cc);
        for(const side of [-1,1])cube(a,this.base,side*.112,.055,.22,.018,.06,.07,0x252e2e);
        if(a.ripple>0&&a.waterY!==undefined)this.put(this.ripples,this.ripple++,this.base,0,a.waterY-a.position.y+.035,0,(1.2-a.ripple)*2.1,1,(1.2-a.ripple)*2.1,0xffffff);
      }else{
        const gull=a.species==='gull',size=gull?1:.72,flapping=a.activity==='takeoff'||a.activity==='land'||response||a.activity==='fly'&&Math.sin(time*.6+a.phase)>.2;
        cube(a,this.base,0,.24,0,.3*size,.32*size,.59*size,c);
        cube(a,this.base,0,.45,.24,.25*size,.27*size,.29*size,c,0,pulse*.25);
        cube(a,this.base,0,.4,.44,.1*size,.09*size,.2*size,0xc9a24c);
        for(const side of [-1,1]){
          cube(a,this.base,side*.13*size,.5,.34,.025,.045,.05,0x27302e);
          this.head.copy(this.base).multiply(this.pivot.makeTranslation(side*.16*size,.3,0));
          const flap=flapping?Math.sin(time*(response?21:13)+a.phase)*.9:a.activity==='perch'?.95:.08;
          this.head.multiply(this.pivot.makeRotationZ(-side*flap));
          cube(a,this.head,side*.32*size,0,-.04,.64*size,.065,.34*size,c,0,0,0);
          cube(a,this.head,side*.63*size,-.015,-.09,.19*size,.065,.27*size,gull?0x555b5e:c);
          if(a.activity==='perch')cube(a,this.base,side*.075,.045,0,.045,.08,.12,0x796343);
        }
        cube(a,this.base,0,.22,-.36,.2*size,.045,.29*size,gull?0x61666b:c,.15);
      }
    }
    for(const [mesh,count] of [[this.parts,this.part],[this.faces,this.face],[this.contacts,this.contact],[this.ripples,this.ripple]] as const){
      mesh.count=count;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.boundingSphere=null;
    }
    this.root.updateMatrixWorld(true);
  }
  animalForHit(object:THREE.Object3D,instanceId:number):number|undefined {
    return object===this.parts?this.partIds[instanceId]:object===this.faces?this.faceIds[instanceId]:undefined;
  }
  clear(){for(const mesh of [this.parts,this.faces,this.contacts,this.ripples])mesh.count=0;}
  dispose(){
    this.root.removeFromParent();for(const mesh of [this.parts,this.faces,this.contacts,this.ripples]){mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();}
    for(const texture of this.textures)texture.dispose();
  }
}

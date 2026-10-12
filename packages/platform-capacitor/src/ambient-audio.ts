import {Capacitor,registerPlugin} from '@capacitor/core';
export interface AmbientImport {id:string;name:string;bytes:number;durationMs:number}
interface AmbientAudioPlugin {
  configure(options:{sources:string[];volume:number}):Promise<void>;
  list():Promise<{items:AmbientImport[]}>;
  importAudio():Promise<{cancelled:boolean;item?:AmbientImport}>;
  remove(options:{id:string}):Promise<void>;
}
export const nativeAmbientAudio=registerPlugin<AmbientAudioPlugin>('AmbientAudio');
export const isNativeAmbient=()=>Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android';

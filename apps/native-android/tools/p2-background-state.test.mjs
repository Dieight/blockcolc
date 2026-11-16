import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshActivityCommit,previewStorage,previewStorageRestored,previewNotificationIds,previewScreenOff,previewCapabilities} from './p2-background-state.mjs';
const xml=(database,before)=>'<map>'+[['database',database],['beforeTest',before]].filter(([,v])=>v).map(([key,value])=>`<string name="${key}">${value}</string>`).join('')+'</map>';
test('battery-exempt exact capability is separate from both-denied and both-granted conditions',()=>{
  assert.deepEqual(previewCapabilities('restricted'),{notify:false,exact:false});
  assert.deepEqual(previewCapabilities('granted'),{notify:true,exact:true});
  assert.deepEqual(previewCapabilities('exact-only'),{notify:false,exact:true});
  assert.notDeepEqual(previewCapabilities('restricted'),previewCapabilities('exact-only'));
  assert.throws(()=>previewCapabilities('whatever'),/Unknown/);
});
test('an old instrumentation snapshot is not a fresh Activity commit',()=>{
  const seed={database:'p2-device-a.db',revision:7,phase:'FOCUS'};
  assert.equal(freshActivityCommit(seed,{...seed,canNotify:true},seed.database),false);
  assert.equal(freshActivityCommit(seed,{...seed,revision:8},seed.database),true);
  assert.equal(freshActivityCommit(seed,{...seed,revision:'8'},seed.database),false);
  assert.equal(freshActivityCommit(seed,{...seed,revision:8,database:'p2-other.db'},seed.database),false);
  assert.equal(freshActivityCommit(seed,{...seed,revision:8,phase:'REST'},seed.database),false);
});
test('restore evidence needs the actual original pointer and no remaining marker',()=>{
  const original=xml('p2-state.db');
  assert.equal(previewStorageRestored(original,xml('p2-device-a.db','p2-state.db')),false);
  assert.equal(previewStorageRestored(original,xml('p2-device-a.db')),false);
  assert.equal(previewStorageRestored(original,xml('p2-state.db','p2-state.db')),false);
  assert.equal(previewStorageRestored(original,original),true);
  assert.equal(previewStorageRestored(xml('p2-device-a.db','p2-state.db'),original),false);
  assert.deepEqual(previewStorage('<map/>'),{database:'p2-state.db',beforeTest:null});
});
test('unsafe or duplicate evidence pointers are rejected, not marked restored',()=>{
  assert.throws(()=>previewStorage(xml('../production.db')),/Invalid/);
  assert.throws(()=>previewStorage(xml('p2-state.db').replace('</map>','<string name="database">p2-other.db</string></map>')),/Invalid/);
});
test('active notifications exclude other packages, history and missing sections',()=>{
  const text='  Notification List:\n    NotificationRecord(abc pkg=com.blockcolc.preview user=0 id=2702 tag=null)\n    NotificationRecord(def pkg=com.blockcolc.app user=0 id=2701 tag=null)\n  Historical notifications:\n    NotificationRecord(old pkg=com.blockcolc.preview user=0 id=2701 tag=null)\n';
  assert.deepEqual(previewNotificationIds(text),[2702]);
  assert.throws(()=>previewNotificationIds('Historical notifications:\n'),/unavailable/);
  assert.throws(()=>previewNotificationIds('  Notification List:\n    NotificationRecord(abc pkg=com.blockcolc.preview user=0)\n'),/ID unavailable/);
});
test('ambient AOD screen-off is not confused with an interactive screen or deep Doze',()=>{
  assert.deepEqual(previewScreenOff('  mWakefulness=Dozing\n'),{state:'Dozing',screenOff:true});
  assert.deepEqual(previewScreenOff('  mWakefulness=Asleep\n'),{state:'Asleep',screenOff:true});
  assert.equal(previewScreenOff('  mWakefulness=Awake\n').screenOff,false);
  assert.throws(()=>previewScreenOff('mWakefulnessChanging=false'),/unavailable/);
});

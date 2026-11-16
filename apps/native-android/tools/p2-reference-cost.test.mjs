import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observeP2Repository,observeP2Transactions} from './p2-reference-cost.mjs';

test('repository measurement keeps the actual receiver, result and validation failure',async()=>{
  let at=0,active=null;const clock=()=>String(++at),source={revision:4,async save(_state,expected){assert.equal(this,source);if(expected!==this.revision)throw Error('conflict');return ++this.revision;}};
  const observed=observeP2Repository(source,()=>active,clock);assert.equal(await observed.save({},4),5);
  active={marks:{},spans:[],transactions:[]};assert.equal(await observed.save({},5),6);
  assert.ok(active.marks.repositorySaveAcknowledgedNs);assert.equal(active.spans[0].ok,true);
  active={marks:{},spans:[],transactions:[]};await assert.rejects(observed.save({},4),/conflict/);
  assert.equal(active.spans[0].ok,false);assert.equal(active.marks.repositorySaveAcknowledgedNs,undefined);
  assert.doesNotMatch(JSON.stringify(active),/expected|_state/);
});
test('transaction is only acknowledged by its real complete event, aborted writes stay failures',()=>{
  let at=0;const cost={transactions:[]};
  class Database{transaction(stores,mode){return Object.assign(new EventTarget(),{objectStoreNames:stores,mode});}}
  const original=Database.prototype.transaction,restore=observeP2Transactions(Database.prototype,()=>cost,()=>String(++at));
  const tx=new Database().transaction(['appState'],'readwrite');assert.equal(cost.transactions[0].endNs,undefined);
  tx.dispatchEvent(new Event('complete'));assert.equal(cost.transactions[0].ok,true);assert.equal(cost.transactions[0].facts,true);
  const bad=new Database().transaction(['appState'],'readwrite');bad.dispatchEvent(new Event('abort'));assert.equal(cost.transactions[1].ok,false);
  restore();assert.equal(Database.prototype.transaction,original);
});

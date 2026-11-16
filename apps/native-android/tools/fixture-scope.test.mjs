import test from 'node:test';
import assert from 'node:assert/strict';
import {P1_FIXTURES,fixtureForStyle,exportArguments} from './fixture-scope.mjs';

test('previous two-fixture invocation stays unchanged; all adds basic valley and sky inputs',()=>{
  assert.deepEqual(exportArguments(['out']).fixtures.map(f=>f.name),['ocean','coast']);
  assert.deepEqual(exportArguments(['out','day','original','all']).fixtures,P1_FIXTURES);
  assert.deepEqual(P1_FIXTURES.map(f=>f.style),['ocean-island','mosaic-coast','natural-valley','classic-island']);
  for(const fixture of P1_FIXTURES)assert.equal(fixtureForStyle(fixture.style).name,fixture.name);
});
test('local client import needs explicit source; invalid scope or output names never become styles',()=>{
  assert.equal(exportArguments(['out','rain','mc263','main','C:/local/26.3.jar']).jar,'C:/local/26.3.jar');
  assert.equal(exportArguments(['out','day','mc263','main','local.jar','--inventory-only']).inventoryOnly,true);
  for(const args of [[],['out','sun'],['out','day','mc263'],['out','day','original','all','extra.jar'],
    ['out','day','mc263','main','not-a-jar'],['out','day','original','../escape'],['out','day','mc263','all','a.jar','extra']])
    assert.throws(()=>exportArguments(args));
  assert.throws(()=>fixtureForStyle('../ocean'));
  assert.throws(()=>fixtureForStyle('ocean-island',250));
});

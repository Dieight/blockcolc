import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fullRunExitCode,shouldStopFullRun} from './full-run-policy.mjs';

for(const collect of [true,false]) test(`full suite policy: ${collect ? 'collect' : 'fail-fast'}`,()=>{
  const visited=[];
  for(const [name,exitCode] of [['core',1],['visual',2],['renderer',0]]) {
    visited.push({name,exitCode});
    if(shouldStopFullRun(exitCode,collect)) break;
  }
  assert.deepEqual(visited.map(step=>step.name),collect ? ['core','visual','renderer'] : ['core']);
  assert.equal(fullRunExitCode(visited),1); // A later pass must never erase failure.
});
test('a fully passing run completes under either policy',()=>{
  for(const collect of [true,false]) assert.equal(shouldStopFullRun(0,collect),false);
  assert.equal(fullRunExitCode([{exitCode:0},{exitCode:0}]),0);
});

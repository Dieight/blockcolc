"""Upsert an approved public focus source on our VPS, without a reporting key.
The source account is a read-only adapter identity, not a human login.
"""
import argparse
import json
import pathlib
import subprocess
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--configuration', type=pathlib.Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    sources = json.loads(args.configuration.read_text(encoding='utf-8-sig'))
    if not isinstance(sources, list) or not sources:
        parser.error('Expected one or more public source configurations')
    # Full protocol validation is also performed by the service constructor.
    if any(not isinstance(s, dict) or s.get('origin') != 'https://platform.arcol.site'
           for s in sources):
        parser.error('Only the approved public origin is supported')
    if not args.apply:
        print(json.dumps({'validatedOrigin': True, 'applied': False, 'sources': len(sources)}))
        return
    script = r'''
import fs from 'node:fs';
import {DatabaseSync,backup} from 'node:sqlite';
import {ExternalFocusBridge} from '/opt/blockcolc-cloud/current/src/external-focus.mjs';
import {CloudStore} from '/opt/blockcolc-cloud/current/src/store.mjs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const path='/etc/blockcolc-cloud/external-focus.json',prior=JSON.parse(fs.readFileSync(path,'utf8'));
const merged=new Map(prior.map(source=>[source.id,source]));for(const source of input)merged.set(source.id,source);
const config=JSON.stringify([...merged.values()]),temp=path+'.new',stat=fs.statSync(path);
// Validate and provision into an isolated throwaway database first.
const staging=fs.mkdtempSync(join(tmpdir(),'blockcolc-external-config-'));
try{
  const candidate=join(staging,'sources.json');fs.writeFileSync(candidate,config,{mode:0o600});
  const store=new CloudStore(join(staging,'db'));
  try{const bridge=new ExternalFocusBridge(store,{configuration:candidate});await bridge.stop();}finally{store.close();}
}finally{fs.rmSync(staging,{recursive:true,force:true});}
const stamp=new Date().toISOString().replace(/[-:.]/g,'');
const db=new DatabaseSync('/var/lib/blockcolc-cloud/cloud.db',{readOnly:true});
try{
  for(const source of input){
    const old=db.prepare('SELECT * FROM external_sources WHERE id=?').get(source.id);
    const account=db.prepare('SELECT id FROM accounts WHERE username=?').get(source.accountUsername);
    if(old&&(old.remote_account!==(source.username??'')||old.user!==account?.id))throw Error('External identity changed');
    if(!old&&account)throw Error('External account name already used');
  }
  await backup(db,'/var/lib/blockcolc-cloud/cloud-before-external-'+stamp+'.db');
}finally{db.close();}
fs.copyFileSync(path,path+'.previous');fs.chmodSync(path+'.previous',0o640);
fs.writeFileSync(temp,config,{mode:0o640});fs.chownSync(temp,stat.uid,stat.gid);fs.renameSync(temp,path);
console.log(JSON.stringify({configurationSaved:true,sources:input.length,previousRetained:true}));
'''
    ssh = ['ssh', '-i', str(pathlib.Path.home()/'.ssh/codex_vps_107_150_98_105'),
           '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15',
           'ubuntu@107.150.98.105']
    remote = '/tmp/blockcolc-external-' + uuid.uuid4().hex + '.mjs'
    subprocess.run(ssh+['umask 077; cat > '+remote], input=script.encode(), check=True, timeout=30)
    try:
        result = subprocess.run(ssh+['sudo -n /opt/blockcolc-node/bin/node '+remote],
                                input=json.dumps(sources).encode(), capture_output=True, timeout=45)
        if result.returncode:
            raise SystemExit('External source configuration failed; no credential or raw response was printed.')
        print(result.stdout.decode().strip())
        subprocess.run(ssh+['sudo -n systemctl restart blockcolc-cloud && sudo -n systemctl is-active blockcolc-cloud'],
                       check=True, timeout=30)
    finally:
        subprocess.run(ssh+['rm -f '+remote], check=True, timeout=30)


if __name__ == '__main__':
    main()

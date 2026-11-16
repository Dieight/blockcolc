"""Bind one approved account to a protected legacy-target configuration.
No credentials are accepted as command-line arguments or printed in output.
Only operator-bound accounts forward; there is no App forwarding switch.
"""
import argparse
import json
import pathlib
import re
import subprocess
import urllib.parse
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--account', required=True)
    parser.add_argument('--configuration', type=pathlib.Path, required=True,
                        help='Private JSON containing url, token and optional sourceEpoch')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--defer-restart', action='store_true', help='Stage alongside a service deployment; restart after the compatible code is installed')
    args = parser.parse_args()
    try:
        valid_account = str(uuid.UUID(args.account)) == args.account
    except ValueError:
        valid_account = False
    if not valid_account:
        parser.error('Expected an account UUID')
    target = json.loads(args.configuration.read_text(encoding='utf-8-sig'))
    if not isinstance(target, dict) or not {'url', 'token', 'enrolledDate'} <= target.keys() or target.keys() - {'url', 'token', 'sourceEpoch', 'previousSourceEpoch', 'initialHistoryCount', 'enrolledDate'}:
        parser.error('Invalid configuration fields')
    if not isinstance(target['url'], str):
        parser.error('Invalid target URL')
    url = urllib.parse.urlsplit(target['url'])
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
        parser.error('Expected a dedicated HTTPS target')
    if not isinstance(target['token'], str) or not 32 <= len(target['token']) <= 4096 or any(ord(c) < 32 for c in target['token']):
        parser.error('Invalid token')
    if 'sourceEpoch' in target and (not isinstance(target['sourceEpoch'], str) or not re.fullmatch(r'[a-zA-Z0-9_-]{16,80}', target['sourceEpoch'])):
        parser.error('Invalid source epoch')
    if 'previousSourceEpoch' in target and (not isinstance(target['previousSourceEpoch'], str) or not re.fullmatch(r'[a-zA-Z0-9_-]{16,80}', target['previousSourceEpoch']) or target.get('sourceEpoch') in (None, target['previousSourceEpoch'])):
        parser.error('Invalid epoch handoff')
    if 'initialHistoryCount' in target and (type(target['initialHistoryCount']) is not int or not 1 <= target['initialHistoryCount'] <= 1000000 or 'sourceEpoch' not in target):
        parser.error('Invalid initial history requirement')
    import datetime
    try:
        if datetime.date.fromisoformat(target['enrolledDate']).isoformat() != target['enrolledDate']:
            raise ValueError()
    except (ValueError, TypeError):
        parser.error('Invalid enrollment date')
    if not args.apply:
        print(json.dumps({'validated': True, 'applied': False, 'account': args.account,
                          'next': 'Apply only the approved owner binding. It automatically forwards the private minimum projection.'}))
        return
    # The script is fixed code. The account and secret configuration travel
    # only through SSH stdin, never through a generated shell expression.
    script = r"""
const fs=require('node:fs'),{DatabaseSync}=require('node:sqlite');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
if(!/^[a-f0-9-]{36}$/.test(input.account))throw Error('Invalid account');
const db=new DatabaseSync('/var/lib/blockcolc-cloud/cloud.db',{readOnly:true});
if(!db.prepare('SELECT 1 FROM accounts WHERE id=?').get(input.account))throw Error('Account does not exist');
if(db.prepare('SELECT 1 FROM external_sources WHERE user=?').get(input.account))throw Error('A public external source is not an upload owner');
db.close();
const path='/etc/blockcolc-cloud/forwarding.json',config=JSON.parse(fs.readFileSync(path,'utf8'));
for(const [id,target]of Object.entries(config))if(id!==input.account&&target.url===input.target.url)throw Error('Target already bound');
config[input.account]=input.target;
fs.copyFileSync(path,path+'.previous');fs.chmodSync(path+'.previous',0o640);
const temp=path+'.new';fs.writeFileSync(temp,JSON.stringify(config),{mode:0o640});
const before=fs.statSync(path);fs.chownSync(temp,before.uid,before.gid);fs.renameSync(temp,path);
console.log(JSON.stringify({bindingSaved:true,account:input.account,automaticOwnerForwarding:true}));
"""
    # A temporary script contains code only. Its name is independently generated.
    remote = '/tmp/blockcolc-bind-' + uuid.uuid4().hex + '.cjs'
    ssh = ['ssh', '-i', str(pathlib.Path.home()/'.ssh/codex_vps_107_150_98_105'),
           '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'ubuntu@107.150.98.105']
    subprocess.run(ssh+['umask 077; cat > '+remote], input=script.encode(), check=True, timeout=30)
    try:
        result = subprocess.run(ssh+['sudo -n /opt/blockcolc-node/bin/node '+remote],
                                input=json.dumps({'account': args.account, 'target': target}).encode(),
                                capture_output=True, timeout=30)
        if result.returncode:
            # Node source excerpts can include secret data on malformed inputs;
            # fail without echoing stderr from a credential-bearing operation.
            raise SystemExit('Binding failed; private server logs can be inspected locally.')
        if not args.defer_restart:
            subprocess.run(ssh+['sudo -n systemctl restart blockcolc-cloud && sudo -n systemctl is-active blockcolc-cloud'],
                           check=True, timeout=30)
        print(result.stdout.decode().strip())
    finally:
        subprocess.run(ssh+['rm -f '+remote], check=True, timeout=30)


if __name__ == '__main__':
    main()

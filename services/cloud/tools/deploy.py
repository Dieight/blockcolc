"""Deploy blockcolc's API and optional loopback viewer.
Keys and upload bundles live in the ignored experiment directory, never Git.
"""
import argparse, datetime, hashlib, json, pathlib, subprocess, tarfile, time
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
import ipaddress

ROOT = pathlib.Path(__file__).resolve().parents[3]
PRIVATE = ROOT / 'artifacts/experiments/v3.0.0/cloud-deployment-private'
PRIVATE.mkdir(parents=True, exist_ok=True)
KEY = pathlib.Path.home() / '.ssh/codex_vps_107_150_98_105'
KNOWN_HOSTS = KEY.with_name(KEY.name + '_known_hosts')
SSH = ['ssh', '-i', str(KEY), '-o', 'IdentitiesOnly=yes', '-o', f'UserKnownHostsFile={KNOWN_HOSTS}',
       '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', 'ubuntu@107.150.98.105']
VIEWER_FILES = ['account.html', 'account.js', 'account.css', 'viewer.js', 'viewer.css']

def certificates():
    now = datetime.datetime.now(datetime.timezone.utc)
    root_key_path = PRIVATE/'ca.key'
    root_cert_path = PRIVATE/'ca.pem'
    if not root_key_path.exists():
        key = ec.generate_private_key(ec.SECP256R1())
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'blockcolc Cloud Root')])
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                .serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(days=1)).not_valid_after(now+datetime.timedelta(days=3650))
                .add_extension(x509.BasicConstraints(ca=True,path_length=0),True)
                .add_extension(x509.KeyUsage(False,False,False,False,False,True,True,False,False),True).sign(key, hashes.SHA256()))
        root_key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        root_cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    ca_key = serialization.load_pem_private_key(root_key_path.read_bytes(),None)
    ca = x509.load_pem_x509_certificate(root_cert_path.read_bytes())
    leaf_key = ec.generate_private_key(ec.SECP256R1())
    leaf = (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'blockcolc Cloud API')]))
            .issuer_name(ca.subject).public_key(leaf_key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now-datetime.timedelta(days=1)).not_valid_after(now+datetime.timedelta(days=825))
            .add_extension(x509.BasicConstraints(ca=False,path_length=None),True)
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('107.150.98.105'))]),False)
            .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]),False).sign(ca_key,hashes.SHA256()))
    (PRIVATE/'server.key').write_bytes(leaf_key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    (PRIVATE/'server.pem').write_bytes(leaf.public_bytes(serialization.Encoding.PEM)+ca.public_bytes(serialization.Encoding.PEM))
    public = ROOT/'apps/native-android/platform-cloud/src/main/assets/blockcolc-cloud-ca.pem'
    public.parent.mkdir(parents=True,exist_ok=True)
    public.write_bytes(ca.public_bytes(serialization.Encoding.PEM))

def deploy(*, reuse_tls, viewer_web):
    if not reuse_tls:
        certificates()
    if viewer_web is not None:
        viewer_web = viewer_web.resolve(strict=True)
        if not all((viewer_web / name).is_file() for name in VIEWER_FILES):
            raise ValueError('Supply the complete account viewer web directory')
    else:
        subprocess.run(SSH + ['sudo -n test ! -s /etc/blockcolc-cloud/viewer.env'], check=True, timeout=30)
    subprocess.run(['node','tools/build.mjs'],cwd=ROOT/'services/cloud',check=True)
    label=time.strftime('%Y%m%d-%H%M%S')
    bundle=PRIVATE/('cloud-'+label+'.tar.gz')
    files=(list((ROOT/'services/cloud/src').glob('*.mjs')) +
           list((ROOT/'services/cloud/policy').glob('*.md')) + [ROOT/'services/cloud/build/domain.mjs'])
    with tarfile.open(bundle,'w:gz') as tar:
        for file in files: tar.add(file,arcname=file.relative_to(ROOT/'services/cloud'))
        if not reuse_tls:
            tar.add(PRIVATE/'server.key',arcname='tls/server.key')
            tar.add(PRIVATE/'server.pem',arcname='tls/server.pem')
        if viewer_web:
            for name in VIEWER_FILES:
                tar.add(viewer_web / name, arcname='viewer/' + name)
    digest=hashlib.sha256(bundle.read_bytes()).hexdigest()
    remote='/tmp/blockcolc-cloud-'+label+'.tar.gz'
    with bundle.open('rb') as stream:
        subprocess.run(SSH+['umask 077; cat > '+remote],stdin=stream,check=True,timeout=240)
    script=f'''set -eu
printf '%s  %s\n' '{digest}' '{remote}' | sha256sum -c -
if ! test -x /opt/blockcolc-node/bin/node; then
  staging=$(mktemp -d /tmp/blockcolc-node.XXXXXXXX)
  cd "$staging"
  curl --fail --location --connect-timeout 15 --max-time 180 https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o SHASUMS256.txt
  archive=$(awk '/ node-.*-linux-x64.tar.xz$/ {{print $2}}' SHASUMS256.txt)
  test -n "$archive"
  curl --fail --location --connect-timeout 15 --max-time 240 "https://nodejs.org/dist/latest-v24.x/$archive" -o "$archive"
  awk '/ node-.*-linux-x64.tar.xz$/ {{print}}' SHASUMS256.txt | sha256sum -c -
  sudo -n install -d -m 755 /opt/blockcolc-node
  sudo -n tar -xJf "$archive" --strip-components=1 -C /opt/blockcolc-node
fi
id blockcolc-cloud >/dev/null 2>&1 || sudo -n useradd --system --home /var/lib/blockcolc-cloud --shell /usr/sbin/nologin blockcolc-cloud
sudo -n install -d -m 755 /opt/blockcolc-cloud/releases/{label}
sudo -n tar -xzf {remote} -C /opt/blockcolc-cloud/releases/{label}
sudo -n install -d -m 750 -o root -g blockcolc-cloud /etc/blockcolc-cloud
release=/opt/blockcolc-cloud/releases/{label}
unit=/etc/systemd/system/blockcolc-cloud.service
old=$(readlink -f /opt/blockcolc-cloud/current || true)
if sudo -n test -f "$unit"; then sudo -n cp -- "$unit" "$release/previous.service"; fi
if sudo -n test -s "$release/tls/server.key"; then
  if sudo -n test -s /etc/blockcolc-cloud/server.key; then
    sudo -n install -m 600 /etc/blockcolc-cloud/server.key "$release/previous.key"
    sudo -n install -m 644 /etc/blockcolc-cloud/server.pem "$release/previous.pem"
  fi
  sudo -n install -m 640 -o root -g blockcolc-cloud "$release/tls/server.key" /etc/blockcolc-cloud/server.key
  sudo -n install -m 644 -o root -g blockcolc-cloud "$release/tls/server.pem" /etc/blockcolc-cloud/server.pem
  sudo -n rm -- "$release/tls/server.key"
fi
sudo -n test -s /etc/blockcolc-cloud/server.key
sudo -n test -s /etc/blockcolc-cloud/server.pem
restore() {{
  result=$?
  if [ "$result" -ne 0 ] && [ -n "$old" ] && [ -d "$old" ] && [ -f "$release/previous.service" ]; then
    echo "Restoring previous API release" >&2
    sudo -n ln -sfn -- "$old" /opt/blockcolc-cloud/current
    sudo -n install -m 644 "$release/previous.service" "$unit"
    if sudo -n test -s "$release/previous.key"; then
      sudo -n install -m 640 -o root -g blockcolc-cloud "$release/previous.key" /etc/blockcolc-cloud/server.key
      sudo -n install -m 644 "$release/previous.pem" /etc/blockcolc-cloud/server.pem
    fi
    sudo -n systemctl daemon-reload
    sudo -n systemctl restart blockcolc-cloud
  fi
}}
trap restore EXIT
sudo -n ln -s -- "$release" "/opt/blockcolc-cloud/current-{label}.tmp"
sudo -n mv -T -- "/opt/blockcolc-cloud/current-{label}.tmp" /opt/blockcolc-cloud/current
sudo -n tee "$unit" >/dev/null <<'UNIT'
[Unit]
Description=blockcolc account and cloud API
After=network-online.target
[Service]
Type=simple
User=blockcolc-cloud
Group=blockcolc-cloud
WorkingDirectory=/opt/blockcolc-cloud/current
ExecStart=/opt/blockcolc-node/bin/node src/main.mjs
Environment=BLOCKCOLC_CLOUD_DATA=/var/lib/blockcolc-cloud
Environment=BLOCKCOLC_CLOUD_PORT=8443
Environment=BLOCKCOLC_TLS_KEY=/etc/blockcolc-cloud/server.key
Environment=BLOCKCOLC_TLS_CERT=/etc/blockcolc-cloud/server.pem
Environment=BLOCKCOLC_EXTERNAL_CONFIG=/etc/blockcolc-cloud/external-focus.json
EnvironmentFile=-/etc/blockcolc-cloud/viewer.env
StateDirectory=blockcolc-cloud
StateDirectoryMode=0700
UMask=0077
LimitCORE=0
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/blockcolc-cloud
MemoryMax=1G
LimitNOFILE=4096
[Install]
WantedBy=multi-user.target
UNIT
if ! sudo -n test -f /etc/blockcolc-cloud/external-focus.json; then
  printf '[]' | sudo -n tee /etc/blockcolc-cloud/external-focus.json >/dev/null
  sudo -n chown root:blockcolc-cloud /etc/blockcolc-cloud/external-focus.json
  sudo -n chmod 640 /etc/blockcolc-cloud/external-focus.json
fi
sudo -n systemctl daemon-reload
sudo -n systemctl enable blockcolc-cloud
sudo -n systemctl restart blockcolc-cloud
attempts=0
until sudo -n curl -fsS --max-time 2 --cacert /etc/blockcolc-cloud/server.pem \
    --connect-to 107.150.98.105:8443:127.0.0.1:8443 https://107.150.98.105:8443/healthz; do
  attempts=$((attempts+1))
  test "$attempts" -lt 15
  sleep 1
done
if sudo -n test -s /etc/blockcolc-cloud/viewer.env; then
  sudo -n bash -eu -c '. /etc/blockcolc-cloud/viewer.env; curl -fsS --max-time 5 \
    -H "Host: ${{BLOCKCOLC_VIEWER_ORIGIN#https://}}" "http://127.0.0.1:$BLOCKCOLC_VIEWER_PORT/healthz"'
fi
sudo -n systemctl is-active blockcolc-cloud
sudo -n systemctl is-active xray-codex
sudo -n ss -ltnp | awk 'NR==1 || /:443 |:8443 /'
rm -- {remote}
'''
    result=subprocess.run(SSH+['bash -s'],input=script.encode('utf-8'),capture_output=True,timeout=540)
    (PRIVATE/('deploy-'+label+'.log')).write_text(result.stdout.decode('utf-8',errors='replace')+'\n'+result.stderr.decode('utf-8',errors='replace'),encoding='utf-8')
    print(json.dumps({'label':label,'returnCode':result.returncode,'bundleSha256':digest}))
    if result.returncode: raise SystemExit(result.returncode)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--prepare-only',action='store_true')
    parser.add_argument('--reuse-tls',action='store_true', help='keep the installed App API certificate and key')
    parser.add_argument('--viewer-web',type=pathlib.Path, help='private account viewer asset directory')
    args=parser.parse_args()
    certificates() if args.prepare_only else deploy(reuse_tls=args.reuse_tls,viewer_web=args.viewer_web)

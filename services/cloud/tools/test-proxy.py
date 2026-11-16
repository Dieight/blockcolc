"""Loopback-only CONNECT bridge for an SSH test tunnel. No TLS interception.
Android still verifies the production API's IP name and deployment CA.
Never packaged or used by the actual application.
"""
import argparse, select, socket, socketserver

UPSTREAM_PORT=18889

class Connect(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(15)
        header=b''
        while b'\r\n\r\n' not in header and len(header)<8192:
            part=self.request.recv(1024)
            if not part:return
            header+=part
        if not header.startswith(b'CONNECT 107.150.98.105:8443 HTTP/1.'):
            self.request.sendall(b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');return
        with socket.create_connection(('127.0.0.1',UPSTREAM_PORT),10) as upstream:
            self.request.sendall(b'HTTP/1.1 200 Connection Established\r\n\r\n')
            peers=[self.request,upstream]
            while True:
                ready,_,_=select.select(peers,[],[],120)
                if not ready:return
                for source in ready:
                    data=source.recv(65536)
                    if not data:return
                    (upstream if source is self.request else self.request).sendall(data)

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address=True
    daemon_threads=True

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--upstream-port',type=int,default=18889);parser.add_argument('--listen-port',type=int,default=18888)
    options=parser.parse_args();assert 1024<=options.upstream_port<=65535 and 1024<=options.listen_port<=65535;UPSTREAM_PORT=options.upstream_port
    with Server(('127.0.0.1',options.listen_port),Connect) as server:
        print('Loopback test bridge ready',flush=True);server.serve_forever()

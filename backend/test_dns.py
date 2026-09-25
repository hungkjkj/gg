import urllib.request
import socket

old_getaddrinfo = socket.getaddrinfo

def new_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    if host == 'www.forexfactory.com':
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('104.18.6.7', port))]
    return old_getaddrinfo(host, port, family, type, proto, flags)

socket.getaddrinfo = new_getaddrinfo

req = urllib.request.Request('https://www.forexfactory.com/calendar?week=sep18.2017', headers={'User-Agent': 'Mozilla/5.0'})
try:
    print(len(urllib.request.urlopen(req, timeout=15).read()))
except Exception as e:
    print("Error:", e)

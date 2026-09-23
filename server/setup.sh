#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if [[ -e .env || -e turnserver.conf ]]; then
  echo 'Configuration already exists. Edit it explicitly; setup will not overwrite secrets.' >&2
  exit 1
fi
read -r -p 'Your domain (for example, prestera.example.org): ' domain
read -r -p 'Public IPv4 of this VPS: ' public_ip
if [[ ! "$domain" =~ ^[a-zA-Z0-9.-]+$ || ! "$public_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then echo 'Invalid domain or IPv4'; exit 1; fi
IFS=. read -r a b c d <<< "$public_ip"
for octet in "$a" "$b" "$c" "$d"; do if (( 10#$octet > 255 )); then echo 'Invalid IPv4'; exit 1; fi; done
umask 077
server_key=$(openssl rand -hex 32)
turn_secret=$(openssl rand -hex 32)
cat > .env <<EOF
DOMAIN=$domain
PRESTERA_SERVER_KEY=$server_key
TURN_SECRET=$turn_secret
EOF
cat > turnserver.conf <<EOF
listening-port=3478
external-ip=$public_ip
realm=$domain
server-name=$domain
fingerprint
use-auth-secret
static-auth-secret=$turn_secret
min-port=49160
max-port=49415
user-quota=128
total-quota=256
max-bps=4000000
no-cli
no-tls
no-dtls
no-multicast-peers
no-tcp-relay
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
log-file=stdout
simple-log
EOF
# coturn's container user needs read access; this directory must stay private.
chmod 700 .
chmod 644 turnserver.conf
printf '\nServer URL: https://%s\nCreation key is saved in .env (PRESTERA_SERVER_KEY).\nNext: docker compose up -d --build\n' "$domain"

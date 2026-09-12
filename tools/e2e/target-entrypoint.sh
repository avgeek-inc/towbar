#!/bin/sh
set -eu
install -o deploy -g deploy -m 600 /test-key.pub /home/deploy/.ssh/authorized_keys
ssh-keygen -A
if [ "${TOWBAR_TEST_SYSTEMD:-0}" = "1" ]; then
  exec /sbin/init
fi
/usr/sbin/sshd -D -e -o PasswordAuthentication=no -o PermitRootLogin=no &
exec /usr/local/bin/dind dockerd --host=unix:///var/run/docker.sock

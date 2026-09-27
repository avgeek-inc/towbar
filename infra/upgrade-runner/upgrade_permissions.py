"""Dedicated host group shared only with the API container."""
import grp
import json
import os
from pathlib import Path
import pwd
import secrets
import stat
import subprocess
import tempfile

CONFIG = Path('/etc/towbar/upgrade-group.json')


def atomic_write(path, content, mode=0o644, gid=None):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name + '-')
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            if gid is not None:
                os.fchown(stream.fileno(), 0, gid)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        Path(temporary).unlink(missing_ok=True)


def validate_group(group):
    if (group.gr_gid == 0 or group.gr_mem
            or any(user.pw_gid == group.gr_gid for user in pwd.getpwall())
            or any(other.gr_gid == group.gr_gid and other.gr_name != group.gr_name for other in grp.getgrall())):
        raise ValueError('The upgrade group must not grant access to host users.')
    return group.gr_gid


def runtime_group(config=CONFIG):
    fd = os.open(config, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        if info.st_uid != 0 or not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
            raise ValueError('The upgrade group configuration must be root-owned and private.')
        saved = json.load(stream)
    group = grp.getgrnam(saved['name'])
    if group.gr_gid != saved['gid']:
        raise ValueError('The dedicated upgrade group changed; reconfigure it before starting the service.')
    return validate_group(group)


def ensure_group(config=CONFIG):
    if config.exists() or config.is_symlink():
        return runtime_group(config)
    name = 'towbar-upgrade'
    while True:
        try:
            grp.getgrnam(name)
        except KeyError:
            break
        name = 'towbar-upgrade-' + secrets.token_hex(4)
    subprocess.run(['groupadd', '--system', name], check=True, timeout=30)
    group = grp.getgrnam(name)
    gid = validate_group(group)
    atomic_write(config, json.dumps({'name': name, 'gid': gid}).encode(), 0o600)
    return gid


def prepare_runtime(runtime, gid):
    runtime.mkdir(mode=0o750, exist_ok=True)
    if not stat.S_ISDIR(runtime.lstat().st_mode):
        raise ValueError('The upgrade runtime directory must not be a symlink.')
    os.chown(runtime, 0, gid)
    os.chmod(runtime, 0o750)
    token = secrets.token_hex(32)
    atomic_write(runtime / 'token', token.encode(), 0o640, gid)
    return token

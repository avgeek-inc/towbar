#!/usr/bin/env python3
"""Install the runner from the verified current release without stopping a job."""
import os
from pathlib import Path
import subprocess

from upgrade_permissions import atomic_write, ensure_group

CURRENT = Path('/opt/towbar/current')
LIBRARY = Path('/usr/local/lib/towbar-upgrade')
CONFIG = Path('/etc/towbar')
UNIT = Path('/etc/systemd/system/towbar-upgrade.service')


def install_release(release, library=LIBRARY, config=CONFIG, unit=UNIT):
    source = release / 'infra/upgrade-runner'
    if (source / 'protocol').read_text().strip() != '2':
        raise ValueError('This release needs a manual upgrade of the host service.')
    scripts = {name: (source / name).read_bytes() for name in ('upgrade_permissions.py', 'repository_identity.py', 'runner.py')}
    for name, content in scripts.items():
        compile(content, name, 'exec')
    service = (source / 'towbar-upgrade.service').read_bytes()
    compose = (source / 'compose.yml').read_text()
    if compose.count('@TOWBAR_UPGRADE_GID@') != 1:
        raise ValueError('The release is missing the dedicated API group configuration.')
    gid = ensure_group(config / 'upgrade-group.json')
    library.mkdir(mode=0o755, parents=True, exist_ok=True)
    for name, content in scripts.items():
        atomic_write(library / name, content)
    atomic_write(unit, service)
    atomic_write(config / 'upgrade-compose.yml', compose.replace('@TOWBAR_UPGRADE_GID@', str(gid)).encode(), 0o600)


if __name__ == '__main__':
    if os.geteuid() != 0:
        raise ValueError('Install the upgrade service as root.')
    install_release(CURRENT.resolve())
    subprocess.run(['systemctl', 'daemon-reload'], check=True, timeout=30)

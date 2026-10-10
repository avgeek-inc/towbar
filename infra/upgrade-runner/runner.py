#!/usr/bin/env python3
"""Host-only upgrade broker. No TCP listener and no client-supplied commands."""
import fcntl
import errno
import hmac
import http.client
import http.server
import json
import os
from pathlib import Path
import re
import socket
import socketserver
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
import uuid
from repository_identity import REPOSITORY, RELEASES_API_URL, REPOSITORY_URL
from upgrade_permissions import prepare_runtime, runtime_group

STATE = Path('/var/lib/towbar-upgrade')
RUNTIME = Path('/run/towbar-upgrade')
CLI = '/usr/local/bin/towbar'
CURRENT = Path('/opt/towbar/current')
ACTIVE = {'checking', 'downloading', 'applying', 'verifying', 'restoring'}
STABLE = re.compile(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z')
BLOCKERS = "SELECT coalesce(json_agg(label || ': ' || count), '[]'::json) FROM public.towbar_upgrade_blockers WHERE count > 0;"


class UpgradeFailure(Exception):
    """A fixed, public explanation without command output or environment data."""


def failure_reason(cause, stage):
    if isinstance(cause, UpgradeFailure):
        return str(cause)
    if isinstance(cause, OSError) and cause.errno == errno.ENOSPC:
        return 'There is not enough disk space to continue the upgrade.'
    return 'The upgrade stopped while ' + stage + '.'


def version(value):
    match = STABLE.fullmatch(value) if isinstance(value, str) else None
    if not match or len(value) > 40:
        raise ValueError('Select a published stable version.')
    return tuple(map(int, match.groups()))


def identifier(value):
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError('Invalid request identifier.')
    return value


def save(path, value):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as stream:
        os.chmod(temporary, 0o600)
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def read(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True,
                          timeout=180, **kwargs).stdout.strip()


def install_current_runner():
    run([sys.executable, str(CURRENT / 'infra/upgrade-runner/install.py')])


def restart_runner():
    run(['systemctl', '--no-block', 'restart', 'towbar-upgrade.service'])


def peer_is_root(connection):
    import struct
    return struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1] == 0


def metadata():
    values = dict(line.split('=', 1) for line in (CURRENT / '.towbar-release').read_text().splitlines())
    if values.get('REPOSITORY') != REPOSITORY or (CURRENT / 'infra/upgrade-runner/protocol').read_text().strip() != '2':
        raise ValueError('This installation does not support host upgrades.')
    version(values['VERSION'])
    return values


def database(sql):
    # Only fixed SQL and validated UUIDs reach this local administrative channel.
    return run([CLI, 'compose', 'exec', '-T', 'postgres', 'psql', '-X', '-qAt',
                '-v', 'ON_ERROR_STOP=1', '-U', 'towbar', '-d', 'towbar'], input=sql)


def blockers():
    return json.loads(database(BLOCKERS))


def pause(job_id):
    identifier(job_id)
    # The UPDATE waits for earlier admissions; the subsequent statement sees
    # their committed rows. Do not combine this into a single CTE snapshot.
    output = database("BEGIN; SET LOCAL lock_timeout='10s'; "
        "UPDATE public.towbar_upgrade_admission SET job_id='" + job_id + "' WHERE id=1 AND job_id IS NULL RETURNING id;\n" +
        BLOCKERS + "COMMIT;")
    lines = output.splitlines()
    if len(lines) != 2 or lines[0] != '1':
        raise ValueError('Admission is already paused. Inspect the previous attempt on the host.')
    return json.loads(lines[1])


def unpause(job_id):
    identifier(job_id)
    result = database("UPDATE public.towbar_upgrade_admission SET job_id=NULL WHERE id=1 AND (job_id IS NULL OR job_id='" + job_id + "') RETURNING id;")
    if result != "1":
        raise ValueError("Admission belongs to another attempt. Inspect the host before recovery.")


def github_release(path):
    request = urllib.request.Request(RELEASES_API_URL + path,
        headers={'User-Agent': 'towbar-upgrade', 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(request, timeout=15) as response:
        release = json.load(response)
    version(release.get('tag_name', ''))
    if release.get('draft') is not False or release.get('prerelease') is not False:
        raise ValueError('The target is not a published stable release.')
    return release


def published_release(target):
    version(target)
    published = github_release('/tags/' + target)
    if published['tag_name'] != target:
        raise ValueError('The release tag does not match the target.')
    url = REPOSITORY_URL + '/releases/download/' + target + '/release.json'
    request = urllib.request.Request(url, headers={'User-Agent': 'towbar-upgrade', 'Accept': 'application/json'})
    with urllib.request.urlopen(request, timeout=15) as response:
        release = json.load(response)
    if release.get('schemaVersion') != 1 or release.get('version') != target or release.get('validated') is not True or not re.fullmatch('[0-9a-f]{40}', release.get('commit', '')):
        raise ValueError('The target is not a validated stable release.')
    return {**release, 'body': published.get('body', '')}


class Runner:
    def __init__(self, directory=STATE):
        self.directory = directory
        self.lock = threading.RLock()
        self.restarting = False
        self.job = read(directory / 'job.json')
        if self.job and self.job['state'] in ACTIVE:
            self.update(state='interrupted', message='The upgrade was interrupted before Towbar recorded a final result. Recovery is required before another upgrade.')

    def update(self, **values):
        with self.lock:
            return self.persist({**self.job, **values})

    def persist(self, job, initial=False):
        job = {**job, 'updatedAt': time.time()}
        paths = [self.directory / (job['id'] + '.json'), self.directory / 'job.json']
        # Record a new job as current first so a partial initial write is
        # recovered as interrupted, never an orphaned pending request.
        for path in reversed(paths) if initial else paths:
            save(path, job)
        self.job = job
        return job

    def status(self):
        return {'supported': True, 'job': self.job}

    def plan(self, target):
        with self.lock:
            self.ensure_idle()
            installed = metadata()
            if version(target)[0] != version(installed['VERSION'])[0]:
                raise ValueError('Major-version upgrades require manual host maintenance.')
            if version(target) <= version(installed['VERSION']):
                raise ValueError('Select a newer stable version.')
            release = published_release(target)
            prepared = json.loads(run([CLI, 'upgrade-service', 'plan', target]))
            if prepared['version'] != target or prepared['commit'] != release['commit']:
                raise ValueError('The release could not be pinned.')
            plan = {'id': str(uuid.uuid4()), 'currentVersion': installed['VERSION'],
                    'currentCommit': installed['COMMIT'], 'targetVersion': target,
                    'commit': prepared['commit'], 'releaseUrl': REPOSITORY_URL + '/releases/tag/' + target,
                    'releaseNotes': (release.get('body') or 'See the release page for details.')[:16000],
                    'blockers': blockers(), 'expiresAt': time.time() + 900}
            save(self.directory / 'plan.json', plan)
            return plan

    def ensure_idle(self):
        if self.restarting:
            raise ValueError('The upgrade service is restarting. Try again shortly.')
        if self.job and self.job['state'] not in {'succeeded', 'blocked', 'recovered'}:
            raise ValueError('An upgrade is active or needs host recovery.')

    def start(self, body):
        if set(body) != {'planId', 'requestId', 'actorId'}:
            raise ValueError('Invalid upgrade request.')
        for value in body.values():
            identifier(value)
        with self.lock:
            previous = (self.job if self.job and self.job['id'] == body['requestId']
                        else read(self.directory / (body['requestId'] + '.json')))
            if previous:
                if previous['planId'] != body['planId'] or previous['actorId'] != body['actorId']:
                    raise ValueError('This request identifier belongs to another upgrade.')
                return previous
            self.ensure_idle()
            plan = read(self.directory / 'plan.json')
            installed = metadata()
            if not plan or plan['id'] != body['planId'] or plan['expiresAt'] <= time.time():
                raise ValueError('This confirmation expired. Check the release again.')
            if installed['VERSION'] != plan['currentVersion'] or installed['COMMIT'] != plan['currentCommit']:
                raise ValueError('The installed release changed. Check the release again.')
            job = {**body, 'id': body['requestId'], 'currentVersion': plan['currentVersion'],
                   'targetVersion': plan['targetVersion'], 'commit': plan['commit'], 'blockers': [],
                   'state': 'checking', 'updatedAt': time.time(),
                   'message': 'Pausing new deployments and operations while Towbar checks readiness.'}
            try:
                self.persist(job, initial=True)
            except Exception:
                self.job = {**job, 'state': 'failed'}
                self.record_failure('The upgrade request could not be saved. The upgrade was not started.', 'open')
                raise
            threading.Thread(target=self.execute, args=(plan,), daemon=True).start()
            return self.job

    def execute(self, plan):
        admission = 'unknown'
        stage = 'checking upgrade readiness'
        try:
            busy = pause(self.job['id'])
            admission = 'paused'
            if busy:
                stage = 'resuming deployments and operations'
                self.update(admission='reopening', message='Deployments or operations are still pending. Allowing them to start without upgrading.')
                admission = 'unknown'
                unpause(self.job['id'])
                admission = 'open'
                self.update(state='blocked', admission='open', blockers=busy, message='Finish queued or active deployments and operations, then check again.')
                return
            # Recheck publication and commit after the admission barrier closes.
            stage = 'verifying the selected release'
            published_release(plan['targetVersion'])
            stage = 'downloading and verifying release images'
            self.update(state='downloading', message='Downloading and verifying the release images.')
            environment = {**os.environ, 'TOWBAR_UPGRADE_JOB': self.job['id'], 'TOWBAR_UPGRADE_COMMIT': plan['commit'], 'TOWBAR_NON_INTERACTIVE': '1', 'NO_COLOR': '1'}
            with (self.directory / (self.job['id'] + '.log')).open('w') as log:
                process = subprocess.Popen([CLI, 'upgrade', plan['targetVersion']], env=environment,
                                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                for line in process.stdout:
                    log.write(line)
                    log.flush()
                    for marker, state, message in [
                        ('Applying the database schema', 'applying', 'Applying migrations and replacing services. The dashboard may reconnect.'),
                        ('Verifying the API', 'verifying', 'Checking the API, worker and dashboard.'),
                        ('Upgrade failed; restoring', 'restoring', 'The upgrade failed. The CLI is attempting to restore the previous services.')]:
                        if marker in line:
                            if state != 'restoring':
                                stage = ('applying database changes and restarting services'
                                         if state == 'applying' else 'checking service health')
                            self.update(state=state, message=message)
                exit_code = process.wait()
                if exit_code != 0:
                    raise UpgradeFailure(f'The upgrade command failed while {stage} (exit code {exit_code}).')
            stage = 'verifying the installed release'
            installed = metadata()
            if installed['VERSION'] != plan['targetVersion'] or installed['COMMIT'] != plan['commit']:
                raise UpgradeFailure('The installed release does not match the selected version.')
            stage = 'updating the upgrade service'
            install_current_runner()
            stage = 'resuming deployments and operations'
            self.update(admission='reopening', message='The new version is healthy. Resuming deployments and operations.')
            admission = 'unknown'
            unpause(self.job['id'])
            admission = 'open'
            with self.lock:
                self.restarting = True
                self.update(state='succeeded', admission='open', message='The new version is healthy. Deployments and operations can start again.')
                stage = 'restarting the upgrade service'
                restart_runner()
        except Exception as cause:
            traceback.print_exc()
            if admission == 'open':
                message = ('Deployments and operations can start again, but the upgrade service could not restart.'
                           if stage == 'restarting the upgrade service' else
                           'Deployments and operations can start again, but the upgrade result could not be saved.')
                message += ' Recovery is required before another upgrade.'
            elif admission == 'paused':
                message = failure_reason(cause, stage) + ' New deployments and operations remain paused.'
            else:
                message = failure_reason(cause, stage) + ' Deployments and operations may already be available. Recovery is required before another upgrade.'
            self.record_failure(message, admission)
            self.restarting = False

    def record_failure(self, message, admission):
        with self.lock:
            try:
                self.update(state='failed', admission=admission, message=message)
            except Exception:
                traceback.print_exc()
                # Keep the live status truthful and block another attempt even
                # when storage is unavailable. The durable intent remains for
                # restart recovery; never execute an interrupted attempt again.
                self.job = {**self.job, 'state': 'failed', 'admission': admission,
                            'message': message + ' This status could not be saved.',
                            'updatedAt': time.time()}

    def resume(self):
        with self.lock:
            if self.job and self.job['state'] in ACTIVE:
                raise ValueError('The upgrade is still running.')
            run([CLI, 'doctor'])
            busy = blockers()
            if busy:
                raise ValueError('Unresolved work: ' + ', '.join(busy))
            if self.job:
                self.update(admission='reopening', message='Recovery checks passed. Resuming deployments and operations.')
                admission = 'unknown'
                saved = False
                try:
                    install_current_runner()
                    unpause(self.job['id'])
                    admission = 'open'
                    self.restarting = True
                    self.update(state='recovered', admission='open', message='Recovery is complete. Deployments and operations can start again.')
                    saved = True
                    restart_runner()
                except Exception:
                    self.record_failure(
                        ('Deployments and operations can start again, but the upgrade service could not restart.' if saved else
                         'Deployments and operations can start again, but recovery status could not be saved.')
                        if admission == 'open' else 'Recovery could not be confirmed. Deployments and operations may already be available.',
                        admission)
                    self.restarting = False
                    raise
            return self.status()


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def handle_request(self):
        if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + self.server.token):
            self.send_error(403)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length < 0 or length > 2048 or self.headers.get('Transfer-Encoding'):
                raise ValueError('Invalid request size.')
            self.connection.settimeout(10)
            body = json.loads(self.rfile.read(length)) if length else {}
            route = (self.command, self.path)
            runner = self.server.runner
            if route == ('GET', '/status'):
                result = runner.status()
            elif route == ('POST', '/plan') and set(body) == {'targetVersion'}:
                result = runner.plan(body['targetVersion'])
            elif route == ('POST', '/jobs'):
                result = runner.start(body)
            elif route == ('POST', '/resume') and self.server.allow_resume(self.connection):
                result = runner.resume()
            else:
                self.send_error(404)
                return
            self.respond(200, result)
        except ValueError as error:
            self.respond(409, {'error': str(error)})
        except Exception:
            traceback.print_exc()
            self.respond(503, {'error': 'The upgrade check could not be completed. See the recovery guide.'})

    def respond(self, status, value):
        payload = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def local_request(path, body=None):
    connection = http.client.HTTPConnection('localhost', timeout=200)
    connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.sock.settimeout(200)
    connection.sock.connect(str(RUNTIME / 'runner.sock'))
    connection.request('GET' if body is None else 'POST', path,
                       body=None if body is None else json.dumps(body),
                       headers={'Authorization': 'Bearer ' + (RUNTIME / 'token').read_text()})
    response = connection.getresponse()
    result = json.load(response)
    connection.close()
    if response.status != 200:
        raise ValueError(result.get('error', 'Host runner request failed'))
    return result


def main():
    if os.geteuid() != 0 or Path('/.dockerenv').exists() or Path('/run/.containerenv').exists():
        raise ValueError('Run the upgrade service on the host as root.')
    if sys.argv[1:2] == ['--resume']:
        print(json.dumps(local_request('/resume', {})))
        return
    if sys.argv[1:2] == ['--upgrade']:
        target = sys.argv[2]
        if target == 'latest':
            target = github_release('/latest')['tag_name']
        plan = local_request('/plan', {'targetVersion': target})
        if plan['blockers']:
            raise ValueError(', '.join(plan['blockers']))
        job = local_request('/jobs', {'planId': plan['id'], 'requestId': str(uuid.uuid4()), 'actorId': '00000000-0000-0000-0000-000000000000'})
        while job['state'] in ACTIVE:
            print(job['message'], flush=True)
            time.sleep(5)
            job = local_request('/status')['job']
        print(job['message'])
        if job['state'] != 'succeeded':
            raise ValueError('Upgrade did not complete.')
        return
    STATE.mkdir(mode=0o700, exist_ok=True)
    lock = (STATE / 'runner.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    gid = runtime_group()
    token = prepare_runtime(RUNTIME, gid)
    endpoint = RUNTIME / 'runner.sock'
    endpoint.unlink(missing_ok=True)
    with Server(str(endpoint), Handler) as server:
        server.allow_resume = peer_is_root
        os.chown(endpoint, 0, gid)
        os.chmod(endpoint, 0o660)
        server.token = token
        server.runner = Runner()
        server.serve_forever()


if __name__ == '__main__':
    main()

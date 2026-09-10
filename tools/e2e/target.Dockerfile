FROM docker:28-dind AS docker
FROM caddy:2 AS caddy
FROM ubuntu:24.04
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      bash openssh-server python3 curl coreutils util-linux sudo ca-certificates \
      iptables iproute2 procps xz-utils systemd systemd-sysv \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd docker \
    && useradd -m -s /bin/bash -G docker deploy \
    && passwd -d deploy \
    && mkdir -p /run/sshd /home/deploy/.ssh /etc/caddy /var/lib/docker \
    && chown -R deploy:deploy /home/deploy/.ssh \
    && chmod 700 /home/deploy/.ssh \
    && printf 'deploy ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/deploy
COPY --from=docker /usr/local/bin/ /usr/local/bin/
COPY --from=docker /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
RUN ln -s /usr/local/bin/docker /usr/bin/docker
COPY tools/e2e/target-entrypoint.sh /usr/local/bin/towbar-test-target
COPY tools/e2e/target-docker.service /etc/systemd/system/towbar-test-docker.service
COPY tools/e2e/target-caddy.service /etc/systemd/system/caddy.service
RUN systemctl enable ssh towbar-test-docker caddy \
    && mkdir -p /etc/caddy/towbar \
    && printf 'import /etc/caddy/towbar/*.caddy\n' > /etc/caddy/Caddyfile
VOLUME /var/lib/docker
ENTRYPOINT ["/usr/local/bin/towbar-test-target"]

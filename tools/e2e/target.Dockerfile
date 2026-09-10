FROM docker:28-dind
RUN apk add --no-cache bash openssh-server python3 curl coreutils util-linux sudo \
    && adduser -D -s /bin/bash deploy \
    && addgroup deploy docker \
    && passwd -d deploy \
    && mkdir -p /run/sshd /home/deploy/.ssh \
    && chown -R deploy:deploy /home/deploy/.ssh \
    && chmod 700 /home/deploy/.ssh \
    && printf 'deploy ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/deploy
RUN test -x /usr/bin/docker || ln -s /usr/local/bin/docker /usr/bin/docker
COPY tools/e2e/target-entrypoint.sh /usr/local/bin/towbar-test-target
ENTRYPOINT ["/usr/local/bin/towbar-test-target"]

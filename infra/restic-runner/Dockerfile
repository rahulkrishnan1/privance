# Nightly pg_dump streamed into restic, pushed to Backblaze B2. Built from the
# official restic image (Alpine + busybox + restic). We add the matching
# postgres client and tzdata so the in-container clock resolves UTC.

FROM restic/restic:0.18.1@sha256:39d9072fb5651c80d75c7a811612eb60b4c06b32ffe87c2e9f3c7222e1797e76

RUN apk add --no-cache postgresql17-client tzdata \
  && cp /usr/share/zoneinfo/UTC /etc/localtime \
  && echo UTC > /etc/timezone

COPY backup.sh /usr/local/bin/backup.sh
COPY check.sh /usr/local/bin/check.sh
COPY crontab /etc/crontabs/root

RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/check.sh \
  && chmod 0600 /etc/crontabs/root

# Clear the restic image default ENTRYPOINT (/usr/bin/restic) so CMD takes effect.
ENTRYPOINT []

# Foreground (-f) with verbose logging (-l 8) so cron stdout/stderr lands in
# `docker compose logs restic-runner`.
CMD ["crond", "-f", "-l", "8"]

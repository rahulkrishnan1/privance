# Hetzner VPS provisioning and hardening

Step-by-step guide to provision a hardened Hetzner Cloud VPS and prepare it for a Privance deployment. This guide ends with a host that has Docker installed, a dedicated deploy user, UFW configured, and `/etc/privance/env.d/` ready. Continue with the [Self-hosting quickstart](README.md) from there.

## Choosing a region and SKU

| SKU | Arch | Regions | vCPU/RAM/Disk/Traffic |
|-----|------|---------|----------------------|
| CX23 | x86 | EU (fsn1, nbg1, hel1) | 2 / 4 GB / 40 GB / 20 TB |
| CAX11 | ARM64 | EU (fsn1, nbg1, hel1) | 2 / 4 GB / 40 GB / 20 TB |
| CPX22 | x86 | Global (ash, sin) | 2 / 4 GB / 40 GB / 1 TB |

Default CX23. CPX22 if non-EU. Region cannot be changed after creation; server can be resized within a family only. Consult Hetzner's pricing page for current rates.

## Step 1: Register your SSH key with Hetzner

In the Hetzner Console, Security > SSH Keys > Add SSH Key. Paste `~/.ssh/id_ed25519_privance.pub`, name it with a year-month tag (e.g. `privance-deploy-YYYY-MM`), save. Do NOT enable "set as default key". Verify fingerprint matches `ssh-keygen -lf ~/.ssh/id_ed25519_privance.pub`.

## Step 2: Create the Cloud Firewall

In the Hetzner Console, Firewalls > Create Firewall, name `privance-edge`, all inbound from `0.0.0.0/0, ::/0`:

| Protocol | Port | Description                     |
|----------|------|---------------------------------|
| TCP      | 22   | SSH                             |
| TCP      | 80   | HTTP (Let's Encrypt + redirect) |
| TCP      | 443  | HTTPS                           |
| UDP      | 443  | HTTPS/3 (QUIC)                  |

Outbound: defaults (allow all). Save; do not attach yet.

## Step 3: Create the server

In the Hetzner Console, Servers > Add Server: Ubuntu 24.04 LTS, the SKU and region from above, both IPv4 and IPv6, SSH key from Step 1, `privance-edge` firewall from Step 2, no volumes, Backups off, no placement group, name `privance-prod-01`, empty cloud config.

Hetzner Backups are off because restic to a different provider handles backups (see the backup section in infra/README.md). Record the Public IPv4 and IPv6.

## Step 4: First SSH and base update

```sh
ssh -i ~/.ssh/id_ed25519_privance -o IdentitiesOnly=yes root@<ipv4>
```

Cross-check the host key fingerprint against the Hetzner Console. Keep this session open until Step 6 confirms the deploy user.

```sh
apt-get update
apt-get -y upgrade
apt-get install -y update-notifier-common ufw unattended-upgrades
[ -f /var/run/reboot-required ] && echo "REBOOT NEEDED" || echo "no reboot needed"
```

If reboot needed, `reboot` then reconnect.

## Step 5: Create the deploy user and plant the SSH key

On the VPS as root:

```sh
adduser --gecos "" <deploy-user>
# Prompts for the sudo password. Use a strong one; do not reuse the SSH key passphrase.

install -d -m 700 -o <deploy-user> -g <deploy-user> /home/<deploy-user>/.ssh
echo '<paste-the-public-key-line-here>' > /home/<deploy-user>/.ssh/authorized_keys
chmod 600 /home/<deploy-user>/.ssh/authorized_keys
chown <deploy-user>:<deploy-user> /home/<deploy-user>/.ssh/authorized_keys

echo '<deploy-user> ALL=(ALL) PASSWD: ALL' > /etc/sudoers.d/<deploy-user>
chmod 440 /etc/sudoers.d/<deploy-user>
visudo -cf /etc/sudoers.d/<deploy-user>
# Expected: "/etc/sudoers.d/<deploy-user>: parsed OK"
```

## Step 6: Verify the deploy user, then harden sshd

Keep the Step 4 root session open as an escape hatch. In a second terminal: `ssh -i ~/.ssh/id_ed25519_privance <deploy-user>@<ipv4>` (must land at `$` prompt), then `sudo -v` (returns silently on correct password). Only when both succeed, write the hardened sshd drop-in:

```sh
sudo tee /etc/ssh/sshd_config.d/00-privance.conf >/dev/null <<'EOF'
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_rsa_key
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
KexAlgorithms curve25519-sha256@libssh.org,ecdh-sha2-nistp521,ecdh-sha2-nistp384,ecdh-sha2-nistp256,diffie-hellman-group-exchange-sha256
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr,aes192-ctr,aes128-ctr
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,umac-128-etm@openssh.com,hmac-sha2-512,hmac-sha2-256,umac-128@openssh.com
LogLevel VERBOSE
ClientAliveInterval 300
ClientAliveCountMax 0
MaxAuthTries 3
MaxSessions 5
EOF

sudo sshd -t
# Expected: no output. Anything else means STOP and fix before reload.
sudo systemctl reload ssh
```

Verify from your workstation; all three must pass before logging out of the original root session:

```sh
ssh -i ~/.ssh/id_ed25519_privance root@<ipv4> whoami
# Expected: "Permission denied (publickey)."
ssh -i ~/.ssh/id_ed25519_privance <deploy-user>@<ipv4> whoami
# Expected: prints "<deploy-user>"
ssh -o PreferredAuthentications=password -o BatchMode=yes <deploy-user>@<ipv4> whoami
# Expected: "Permission denied (publickey)."
```

## Step 7: UFW on the host

```sh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw limit 22/tcp comment 'SSH (rate-limited)'
sudo ufw allow 80/tcp comment 'HTTP (LE challenge + redirect)'
sudo ufw allow 443/tcp comment 'HTTPS'
sudo ufw allow 443/udp comment 'HTTPS/3 (QUIC)'
sudo ufw --force enable
sudo ufw status verbose
# Expected: four rules each on IPv4 and IPv6: 22/tcp LIMIT, 80/tcp ALLOW, 443/tcp ALLOW, 443/udp ALLOW
```

From your workstation, `nmap -Pn -p 5432 <ipv4>` should report 5432 as filtered.

## Step 8: Unattended-upgrades

As the deploy user:

```sh
sudo tee /etc/apt/apt.conf.d/52privance-unattended-upgrades >/dev/null <<'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}";
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Package-Blacklist {
    "docker-ce";
    "docker-ce-cli";
    "containerd.io";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
Unattended-Upgrade::Automatic-Reboot-Time "03:00";
EOF

sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

sudo unattended-upgrade --dry-run
# Expected: exits 0.
```

## Step 9: Docker Engine and Compose plugin

Install from Docker's official apt repository, pin the exact version. As the deploy user:

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

ARCH=$(dpkg --print-architecture)
CODENAME=$(. /etc/os-release && echo "${VERSION_CODENAME}")

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${CODENAME}
Components: stable
Architectures: ${ARCH}
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt-get update
```

Run `apt-cache madison docker-ce`, copy the latest version string, and install at exactly that version:

```sh
# Substitute <VERSION_STRING> with the value from `apt-cache madison docker-ce`.
sudo apt-get install -y \
  docker-ce=<VERSION_STRING> \
  docker-ce-cli=<VERSION_STRING> \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin
sudo apt-mark hold docker-ce docker-ce-cli containerd.io

docker --version
docker compose version
systemctl is-active docker
apt-mark showhold
```

To upgrade later: `sudo apt-mark unhold docker-ce docker-ce-cli containerd.io`, upgrade, re-hold.

## Step 10: Add the deploy user to the `docker` group

```sh
sudo usermod -aG docker $USER
exit
ssh -i ~/.ssh/id_ed25519_privance <deploy-user>@<ipv4>
groups                          # lists "docker"
docker info | head -5           # succeeds without sudo
docker run --rm hello-world
```

WARNING: docker group is effectively root (`docker run -v /:/host alpine chroot /host` escalates). Keep to the deploy user only.

## Step 11: Create the secrets directory

Secrets live in `/etc/privance/env.d/`, mode 700, owned by the deploy user; env files mode 600. This step is also covered in the quickstart, but doing it here confirms ownership before Docker runs.

```sh
sudo install -d -m 700 -o <deploy-user> -g <deploy-user> /etc/privance /etc/privance/env.d
stat -c '%a %U %G %n' /etc/privance /etc/privance/env.d
# Expected: two lines, "700 <deploy-user> <deploy-user> ..."
```

The host is now ready. Continue with the [Self-hosting quickstart](README.md) starting at Step 1 (GHCR login). Step 11 above already created `/etc/privance/env.d/`, so skip the directory-creation command at the top of quickstart Step 3 and go straight to writing the config files.

## Rollback notes

- Wrong region or SKU: delete and recreate; within-family resize works in-place.
- Locked out by sshd: `sudo rm /etc/ssh/sshd_config.d/00-privance.conf && sudo systemctl reload ssh`. If no session remains, use the Hetzner Console KVM (root login works there).
- UFW broke routing: `sudo ufw disable`, then re-apply Step 7.
- Unattended-upgrades misbehaving: `sudo rm /etc/apt/apt.conf.d/52privance-unattended-upgrades`.
- Wrong Docker version: unhold, reinstall at the correct version, re-hold.
- Wrong deploy user: `sudo userdel -r <name>` then re-run Step 5.

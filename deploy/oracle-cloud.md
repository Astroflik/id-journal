# Deploying on an Oracle Cloud VM

This keeps the Ruby app and account data on an external VM. The computer used
to upload the files can be turned off afterward. Oracle's Always Free capacity
is limited and can be reclaimed when idle; keep an independent backup of the
account database.

## 1. Create the VM and hostname

1. Create an Oracle Cloud Free Tier account and a VM in the home region. Ubuntu
   24.04 ARM is a suitable choice; select an Always Free Ampere shape if one is
   available.
2. Save the VM's public IP and SSH key. In the VM's ingress rules, allow SSH
   (TCP 22) only from your own IP, and allow HTTP/HTTPS (TCP 80 and 443).
3. Point a domain or free DuckDNS hostname to the VM's public IP. HTTPS is
   required before real account passwords or journal data are sent over the
   internet.

Oracle may ask for a payment card to verify identity. The free VM is subject to
regional capacity and availability limits.

## 2. Install the app on Ubuntu

Connect over SSH, then run:

```sh
sudo apt update
sudo apt install -y ruby ruby-webrick nginx certbot python3-certbot-nginx rsync
sudo useradd --system --no-create-home --shell /usr/sbin/nologin journal
sudo mkdir -p /opt/journal-by-myidgod
sudo chown "$USER":"$USER" /opt/journal-by-myidgod
```

From the project directory on the Mac, copy the app files. Replace `VM_IP` with
the public IP:

```sh
rsync -av --exclude='.data/' --exclude='.obsidian/' --exclude='.DS_Store' \
  ./ ubuntu@VM_IP:/opt/journal-by-myidgod/
```

The local `.data` file is deliberately excluded. To move existing trades and
settings, create a JSON backup on the local site and import it into your hosted
account after deployment.

On the VM, install the included service and Nginx configuration:

```sh
sudo chown -R root:root /opt/journal-by-myidgod
sudo chmod -R a-w /opt/journal-by-myidgod
sudo cp /opt/journal-by-myidgod/deploy/journal.service /etc/systemd/system/journal.service
sudo cp /opt/journal-by-myidgod/deploy/nginx-journal.conf /etc/nginx/sites-available/journal
```

Edit `/etc/nginx/sites-available/journal` and replace
`journal.example.com` with your hostname, then enable and start both services:

```sh
sudo ln -s /etc/nginx/sites-available/journal /etc/nginx/sites-enabled/journal
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now journal
sudo systemctl enable --now nginx
```

If the symbolic link already exists, do not create it again. Check the Ruby
service with `sudo systemctl status journal` and confirm that
`http://YOUR_HOSTNAME/` loads before requesting TLS.

## 3. Enable HTTPS

Replace `YOUR_HOSTNAME` and `YOUR_EMAIL` with your actual values:

```sh
sudo certbot --nginx -d YOUR_HOSTNAME --email YOUR_EMAIL --agree-tos --redirect
```

Open `https://YOUR_HOSTNAME/` and create an account. Nginx forwards requests to
the Ruby server on loopback; the app is not exposed directly to the internet.

## 4. Move existing journal data

1. On the local journal, click **Резервная копия (JSON)** and keep the downloaded
   file somewhere private.
2. On the hosted HTTPS site, create your account and click **Импорт**.
3. Choose that backup and confirm replacement. Trades, plans, and settings are
   restored and synced to the account.
4. Make a separate backup regularly. The account database is stored in
   `/var/lib/journal-by-myidgod/accounts.pstore`; do not serve or publish this
   file.

Intro videos and custom video backgrounds are browser-local media and do not
move with the account backup. Password reset and email verification are not
configured; keep the password safe and maintain private backups.

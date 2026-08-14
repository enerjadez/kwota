# KWOTA

WhatsApp quotes for trades. Voice it. Send it. Get the deposit.

## Run

Double-click `kwota.bat`, or:

```
npm install
npm start
```

Then open http://localhost:7744/?demo=1

Leave the window open. The app is the browser page — the `.bat` only starts the engine.

## Data

Quotes and businesses live in `data/kwota.json` on the machine that runs the server. That file is gitignored. No cloud unless you deploy this somewhere.

## Phone on the same Wi-Fi

Open the printed `http://YOUR-LAN-IP:7744` URL. If it fails, once as admin:

```
netsh advfirewall firewall add rule name="KWOTA" dir=in action=allow protocol=TCP localport=7744 profile=private
```

# Project Canvas – interaktiv & gemeinsam

Ein interaktives **Project Canvas** (nach der Vorlage mit Zielsetzung, Kriterien, Erfolgskriterien,
Meilensteinen, Arbeitspaketen, Ergebnis, Team, Stakeholdern, Nutzern, Ressourcen, Projektumfeld und Risiken),
an dem mehrere Personen **gleichzeitig in Echtzeit** arbeiten können.

**Keine Benutzerkonten:** Jedes Canvas hat eine lange, zufällige ID (256 Bit). Wer den Link kennt, kann mitarbeiten.

## Start mit Docker

```bash
docker compose up -d --build
```

Dann im Browser öffnen: <http://localhost:3000>. Die Daten liegen im Docker-Volume `canvas-data`.

Ohne Compose:

```bash
docker build -t projectcanvas .
docker run -d -p 3000:3000 -v canvas-data:/data --name projectcanvas projectcanvas
```

Ohne Docker (Node ≥ 18): `npm install && npm start`

## So funktioniert's

1. **„Neues Canvas erstellen“** klicken.
2. Namen eingeben (wird nur im Browser gespeichert, damit andere sehen, wer mitarbeitet).
3. **„🔗 Einladen“** → Link kopieren, per E-Mail oder Messenger teilen.
4. Alle mit dem Link sehen Änderungen sofort live.

### Bedienung

- **+** im Feld oder **Doppelklick** auf eine freie Fläche → neue Notiz
- **Strg/Cmd + Enter** → weitere Notiz darunter, **Backspace** in leerer Notiz → löschen
- **⠿** ziehen → Notiz verschieben (auch zwischen Feldern, funktioniert mit Touch)
- **●** → Farbe ändern, **×** → löschen (mit „Rückgängig“)
- Meilensteine haben ein Datum und werden danach sortiert, Arbeitspakete lassen sich abhaken
- Farbiger Rahmen mit Namen zeigt, wer gerade welche Notiz bearbeitet
- **Drucken** → als PDF speichern (A3 quer), **Export/Import** als JSON

## Konfiguration

| Variable   | Standard | Bedeutung             |
|------------|----------|-----------------------|
| `PORT`     | `3000`   | HTTP-Port             |
| `DATA_DIR` | `/data`  | Speicherort der Canvases (eine JSON-Datei pro Canvas) |

## Hinweise zum Betrieb im Internet

- Hinter einen Reverse-Proxy mit **HTTPS** stellen (z. B. Caddy, Traefik, nginx). WebSockets laufen über `/ws`
  und müssen durchgereicht werden. Beispiel Caddy: `canvas.example.de { reverse_proxy localhost:3000 }`
- Der Link ist der Schlüssel: Wer ihn hat, kann bearbeiten. Nur mit dem Team teilen.
- Backup: einfach das Volume bzw. den Ordner `DATA_DIR` sichern.

Lizenz der Canvas-Vorlage: CC BY-SA (siehe Original „project canvas“).

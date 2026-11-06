# OSP-Projektmanagement

Werkzeug für die Definitions- und Planungsphase des Oberstufenprojekts (OSP). Es enthält genau die
Planungsdokumente aus dem Kick-off („Planungsdokumente – WuB“). Alle Gruppenmitglieder bearbeiten sie gleichzeitig,
Änderungen erscheinen sofort bei allen.

| Bereich | Inhalt |
|---|---|
| Project Canvas | Canvas nach Vorlage, live gemeinsam bearbeitbar. Entwicklungsschritte als Versionen speichern und ansehen |
| Pflichtenheft (vorläufig) | Gliederung nach PH-Vorlage (Kapitel 1–8, Glossar, Bestätigung). Muss-, Wunsch- und Abgrenzungskriterien mit automatischen IDs (//M01, //W01, //A01). Qualitätsanforderungen als Tabelle |
| Projektstrukturplan | Baum mit numerischer Codierung (1, 1.1, 1.1.1). Teilprojekt, Teilaufgabe, Arbeitspaket. Grafik und Tabelle |
| Zeitplan (Gantt) | Vorgänge = PSP-Elemente. Start/Ende/Dauer, Vorgänger mit Pfeilen, Sammelvorgänge, Meilensteine. Personen pro Vorgang („Klaus, Lilly“ bzw. „3 Personen“). Wochenenden und Feiertage NRW. Balken verschieben und ziehen |
| Ressourcen- und Kostenplan | Personen × Stunden je Person × Stundensatz (aus den Arbeitspaketen), Stunden je Person, Sachmittel, Gesamtkosten |
| Risikoplan / -matrix | Spalten wie Vorlage (Nr., Risiko, Ursache, Schadensausmaß, Eintrittswahrscheinlichkeit, Bewertung, Maßnahme), Risikoarten, Maßnahmenarten, farbige Matrix |
| Qualitätsplan | Produkt- und Prozessqualität: Maßnahme, Kriterium (WAS), Zielgröße (WIE), Zeitpunkt (WANN), Verantwortlicher (WER) |
| Arbeitspaketbeschreibung | Formular nach LS6.2, Daten aus PSP/Gantt, mit Unterschriftenfeldern |
| Fragenkatalog | Phasen Begrüßung bis Verabschiedung |
| Grobe Zeitplanung | Datum, Was ist zu tun?, Wer hilft mit?, Verantwortlicher?, Was wurde getan? |

Jedes Dokument hat eine **Dokumentansicht**. Von dort lässt es sich **drucken / als PDF speichern** oder
**als Word-Datei** herunterladen und weiterbearbeiten (Gantt: nur Drucken/PDF). Für Kanban nutzt ihr weiter Trello,
der Board-Link kann in der Projektübersicht hinterlegt werden.

## Start mit Docker

```bash
docker compose up -d --build
```

Dann <http://localhost:3000> öffnen. Die Daten liegen im Docker-Volume `osp-data`.

## Benutzerkonten

**Standard-Admin beim ersten Start:** Benutzername `admin`, Passwort `admin`.
Beim ersten Anmelden muss ein eigenes Passwort gesetzt werden, vorher ist nichts anderes erreichbar.

1. Jede Person registriert sich unter `/register` (Name, E-Mail, Passwort).
2. Danach ist das Konto **gesperrt, bis ein Admin es freischaltet** (Menüpunkt „Benutzerverwaltung“, offene Anfragen sind mit einer Zahl markiert).

Admins können freischalten, ablehnen, sperren, andere zu Admins machen, Passwörter neu setzen und Projekte löschen.
Alle freigeschalteten Benutzer sehen und bearbeiten alle Projekte.

## Konfiguration

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port |
| `DATA_DIR` | `/data` | Speicherort (Benutzer, Sitzungen, ein JSON pro Projekt) |
| `ADMIN_LOGIN` | `admin` | Benutzername des Standard-Admins (nur beim ersten Start, wenn noch kein Admin existiert) |
| `ADMIN_PASSWORD` | `admin` | Start-Passwort des Standard-Admins (muss beim ersten Login geändert werden) |
| `COOKIE_SECURE` | `false` | `true` setzen, wenn über HTTPS betrieben |

Im Internet hinter einen Reverse-Proxy mit HTTPS stellen. WebSockets laufen über `/ws` und müssen durchgereicht werden,
z. B. mit Caddy: `osp.example.de { reverse_proxy localhost:3000 }`.

**Backup:** das Volume bzw. den Ordner `DATA_DIR` sichern. Einzelne Projekte lassen sich zusätzlich in der Übersicht als JSON herunterladen.

# OSP-Projektmanagement

Werkzeug für die Definitions- und Planungsphase des Oberstufenprojekts (OSP). Es enthält die Planungsdokumente aus dem Kick-off
(„Planungsdokumente – WuB“). Das ganze Team bearbeitet sie gleichzeitig, Änderungen erscheinen sofort bei allen.
Hell- und Dunkelmodus sind umschaltbar (oben „Darstellung“).

## Start mit Docker

```bash
docker compose up -d --build
```

Dann <http://localhost:3000> öffnen.

**Erster Login:** Benutzername `admin`, Passwort `admin`. Beim ersten Anmelden muss ein eigenes Passwort gesetzt werden.

## Aufbau

Links die Navigation nach Projektphasen, mit dem Stand (%) jedes Dokuments:

| Bereich | Inhalt |
|---|---|
| **Übersicht** | Countdown bis zur Abgabe, Gesamtstand, Stand je Dokument, offene Punkte, meine Arbeitspakete, Termine der nächsten 14 Tage, letzte Aktivitäten |
| **Projektdaten** | Stammdaten, Kunde und technischer Ansprechpartner, Rollenverteilung, Kommunikationsplan, **Trello-Link** (erscheint in der Seitenleiste und auf der Projektkarte) |
| **Aktivitäten** | Wer hat wann woran gearbeitet, Summe je Person (Nachweis „Sonstige Leistung, Engagement“), druckbar |
| **Project Canvas** | Live gemeinsam bearbeitbar: Mauszeiger der anderen mit Namen, Text erscheint beim Tippen, Kürzel zeigen, wer in welchem Feld arbeitet, jede Notiz zeigt Autor und letzte Bearbeitung, Hinweis wenn jemand dieselbe Notiz bearbeitet. Entwicklungsschritte als Versionen |
| **Fragenkatalog** | Nach Vorlage (Dok. 02): Vorbereitung (IST, SOLL, fehlende Informationen), Termin Kundengespräch, Phasen Begrüßung bis Verabschiedung. Kernphase nach Themengebieten, sortiert nach Fragepyramide (offen, Alternativ, geschlossen, Kontrolle), Spalte für die Antworten im Gespräch |
| **Pflichtenheft** | Gliederung nach PH-Vorlage, Kriterien mit IDs (//M01, //W01, //A01), Qualitätsanforderungen, Glossar, Selbstcheck mit den 14 Bewertungskriterien |
| **Projektstrukturplan** | Baum mit Codierung 1, 1.1, 1.1.1; Grafik und Tabelle |
| **Zeitplan (Gantt)** | siehe unten |
| **Ressourcen- und Kostenplan** | Personen × Stunden × Stundensatz aus den Arbeitspaketen, Stunden je Person, Sachmittel, Gesamtkosten |
| **Risikoplan** | Tabelle nach Vorlage, Risikoarten, Maßnahmenarten, farbige Risikomatrix |
| **Qualitätsplan** | Produkt- und Prozessqualität: Was, Wie, Wann, Wer |
| **Arbeitspaketbeschreibung** | Formular nach LS6.2 mit Unterschriftenfeldern |
| **Grobe Zeitplanung** | Datum, Was ist zu tun?, Wer hilft mit?, Verantwortlicher?, Was wurde getan? |
| **Gesamtdokument** | Alle Planungsdokumente mit Deckblatt in einem Ausdruck/PDF bzw. einer Word-Datei für die Abgabe |

Jedes Dokument hat eine **Dokumentansicht** zum Drucken/als PDF und einen **Word-Export**, außerdem ein Feld zur
**KI-Kennzeichnung** (Kick-off: „Nachweisen/markieren, wo KI genutzt wurde“), das im Ausdruck erscheint.

### Gantt-Editor

- Vorgänge sind die Elemente des Projektstrukturplans, direkt im Gantt anlegen, einrücken und löschen (Menü in jeder Zeile, Enter im Namen = nächster Vorgang)
- **OSP-Ablauf übernehmen:** legt Phasen und Termine aus dem Kick-off als Vorgänge an (Kundengespräch bis 13.11., Abgabe 22.12., Feedback, Überarbeitung bis 22.01., Realisierung ab 25.01., Präsentation bis 19.03.)
- Balken verschieben, Beginn und Ende an den Kanten ziehen
- **Abhängigkeiten per Ziehen** vom Punkt am Balkenende auf einen anderen Vorgang (Kreise werden verhindert)
- **Nachfolger mitziehen** und **Termine berechnen**, optional nur Arbeitstage
- **Kritischer Pfad**, **Fortschritt in %**, Meilensteine, auf- und zuklappbare Sammelvorgänge
- **Auslastung je Person:** zeigt paralleles Arbeiten (rot = mehrere Vorgänge gleichzeitig)
- **Basisplan** speichern und als Soll-Linie anzeigen
- Wochenenden, Feiertage NRW, heute, Projektende und OSP-Termine im Kalender; Arbeitstage-Spalte
- **Rückgängig** (Strg+Z); Zoom Tage, Wochen, Monate, Einpassen
- Druck/PDF wird automatisch auf A4 quer eingepasst

## Benutzerkonten

1. Registrierung unter `/register`. Danach ist das Konto gesperrt, **bis ein Admin es freischaltet** (Benutzerverwaltung).
2. Admins können freischalten, ablehnen, sperren, Admin-Rechte vergeben, Passwörter setzen und Projekte löschen.

## Datenbank

Die Daten liegen in einer **SQLite-Datenbank** (`/data/osp.sqlite` im Docker-Volume `osp-data`). Tabellen:
Benutzer, Sitzungen, Projekte und Aktivitätsprotokoll. Ein zusätzlicher Datenbank-Container ist nicht nötig.
Daten aus älteren Versionen (JSON-Dateien) werden beim ersten Start automatisch übernommen.

**Backup:** das Volume sichern, z. B.

```bash
docker run --rm -v osp-data:/data -v "$PWD":/backup alpine tar czf /backup/osp-backup.tgz -C /data .
```

## Konfiguration

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port |
| `DATA_DIR` | `/data` | Speicherort der Datenbank |
| `ADMIN_LOGIN` | `admin` | Benutzername des Standard-Admins (nur beim ersten Start) |
| `ADMIN_PASSWORD` | `admin` | Start-Passwort, muss beim ersten Login geändert werden |
| `COOKIE_SECURE` | `false` | `true` setzen, wenn über HTTPS betrieben |

Im Internet hinter einen Reverse-Proxy mit HTTPS stellen; WebSockets laufen über `/ws`, z. B. mit Caddy:
`osp.example.de { reverse_proxy localhost:3000 }`.

Ohne Docker: Node.js ab 22.13, dann `npm install` und `npm start`.

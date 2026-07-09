# LAC – LAN Chat

Ein schlanker Messenger für den Chat innerhalb des eigenen lokalen Netzwerks (LAN) – ganz ohne Internet, Server oder Cloud. Nachrichten, Bilder und Dateien werden direkt zwischen den Geräten ausgetauscht.

---
## ☕ Support this project

If this integration saves you time, consider supporting its development:

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-%E2%9D%A4-red?logo=github)](https://github.com/sponsors/OleSint)

This project is and will remain free and open source.
--- 
<br>
## Features

- **Automatische Geräte-Erkennung**: LAC-Instanzen im selben Netzwerk finden sich per UDP-Broadcast von selbst – keine manuelle IP-Eingabe nötig.
- **Mehrere gleichzeitige Kontakte**, jeder mit eigenem, getrenntem Chatverlauf.
- **Manuelles Hinzufügen per IP** als Fallback, falls Broadcasts im Netzwerk blockiert sind.
- **Persistente, ein-/ausklappbare Seitenleiste** mit allen Kontakten, sortierbar per Drag & Drop.
- Ungelesen-Badges pro Chat.
- Medien- und Datei-Versand (Dialog oder direkt per Zwischenablage einfügen).
- Klickbare Links inkl. Best-Effort-Linkvorschau.
- Volltextsuche im Chatverlauf mit Hervorhebung.
- Emoji-Picker.
- Antworten auf einzelne Nachrichten (Zitat-Block).
- Nachrichten löschen – einzeln oder komplett für einen Chat, jeweils mit Sicherheitsabfrage.
- Übersicht über alle geteilten Bilder, Dateien und Links pro Kontakt.
- Kein Server, kein Internet, keine Registrierung – alles bleibt im eigenen Netzwerk.

## Installation (Windows)

1. Aktuelle Version aus dem [Releases](../../releases)-Bereich herunterladen (`LAC Setup X.X.X.exe`).
2. Installer ausführen – LAC startet danach automatisch.
3. Beim ersten Start einen Anzeigenamen vergeben.
4. Andere LAC-Nutzer im selben Netzwerk erscheinen automatisch unter "In der Nähe gefunden" und können mit einem Klick hinzugefügt werden.

Es sind keine weiteren Einstellungen nötig, solange sich beide Geräte im selben lokalen Netzwerk (WLAN/LAN) befinden und UDP-Broadcasts nicht durch eine Firewall blockiert werden.

## Entwicklung

Voraussetzung: [Node.js](https://nodejs.org/).

```bash
npm install
npm start
```

### Windows-Installer bauen

```bash
npm run dist
```

Der fertige Installer liegt danach unter `dist/`.

## Funktionsweise

- Jede Instanz startet einen TCP-Listener (Standard-Port `53911`) für die eigentliche Chat-Verbindung sowie einen UDP-Broadcast (Standard-Port `53910`) zur Erkennung im Netzwerk.
- Kontakte werden über eine feste Geräte-ID identifiziert, nicht über die IP-Adresse – dadurch funktionieren Verbindungen auch nach einem DHCP-Wechsel der IP zuverlässig weiter.
- Alle Daten (Profil, Kontakte, Chatverläufe, empfangene Dateien) werden ausschließlich lokal auf dem jeweiligen Gerät gespeichert.

## Hinweis zum Speicherformat

Ab Version 2.0 wurde das Speicherformat umgestellt (ein Chatverlauf pro Kontakt statt einer gemeinsamen Verlaufsdatei), um mehrere Kontakte zu unterstützen. Bestehende 1.x-Chatverläufe werden beim Update **nicht automatisch übernommen**.

## Lizenz

ISC

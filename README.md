# Rezeptbuch

Rezepteverwaltung als PWA (Ersatz für organizEat). Läuft ohne Build-Schritt, einfach den Ordner statisch ausliefern (z. B. GitHub Pages).

## Inhalt
- `data.js` – Rezepte (Ordner alle 452 Rezepte in 32 Ordnern aus organizEat)
- `app.js`, `style.css`, `index.html` – App mit Suche (Titel, Zutaten, Zubereitung; ohne Umlaut-/Gross-Kleinschreibung)
- `sw.js`, `manifest.webmanifest`, `icons/` – Offline-Betrieb und Installation auf dem Home-Bildschirm

## Daten
Rezepte mit Text (Zutaten, Schritte) sind durchsuchbar. Rezepte, die in organizEat nur als Foto der Buchseite vorliegen, werden als Fotos angezeigt und sind nur über den Titel auffindbar.
Bilder sind verlinkt (nicht im Repo gespeichert) und werden beim ersten Ansehen für den Offline-Betrieb zwischengespeichert.

## Lokal testen
```
python3 -m http.server 8000
```

## Versionierung

Die App-Version steht in `app.js` (`APP_VERSION`) und `sw.js` (`VERSION`) und wird in den Einstellungen angezeigt. Beide Werte immer gemeinsam ändern.

- **Major** (1.x.x): grundlegende Änderungen, z. B. neues Datenformat
- **Minor** (x.1.x): neue Funktionen
- **Patch** (x.x.1): Korrekturen und Rezept-Inhalte

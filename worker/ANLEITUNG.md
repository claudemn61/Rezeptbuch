# Link-Import: Cloudflare-Dienst einrichten (einmalig, kostenlos)

1. Konto auf https://dash.cloudflare.com anlegen (gratis, nur E-Mail nötig).
2. Links «Workers & Pages» → «Create» → «Create Worker» → Namen z. B. `rezeptbuch-import` → «Deploy».
3. «Edit code» wählen, den gesamten Inhalt durch `worker.js` aus diesem Ordner ersetzen → «Deploy».
4. Die Adresse des Workers (`https://rezeptbuch-import.<name>.workers.dev`) kopieren.
5. In der App: Einstellungen → Import → Adresse einfügen → OK.

Der Dienst nimmt nur Anfragen von der Rezeptbuch-App an (claudemn61.github.io).
Gratis-Kontingent: 100'000 Aufrufe pro Tag.

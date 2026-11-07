# Changelog

All notable changes to the CBE Toolbox are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) (`0.x` — pre-release, breaking
changes may occur on minor bumps).

Releasing a version = bump `packages/app/package.json` `version` (increment the
last digit — the entries below never decide which digit moves; see
`docs/build-and-release.md`), move the `Unreleased` items under a new version
heading, tag `v<version>` on `main`.
The `v*` tag triggers the CI build + pre-release (see
`docs/build-and-release.md`). This file is the source for the release notes —
see `docs/release-notes-template.md`. The bilingual lecturer manual starts at
[`docs/user/README.md`](docs/user/README.md). The newest version heading below
`[Unreleased]` must name the app version in `packages/app/package.json`;
`packages/app/tests/release-metadata.test.ts` and the tag workflow refuse a
version without its section.

## [Unreleased]

## [0.1.23] — 2026-11-07

Wartungsrelease für die Veröffentlichung des bereinigten Quellcode-Spiegels.
App-Verhalten, CBE Skill **0.4.2**, Korpus **2026-12** sowie die enthaltenen
Fallstudien und Reifegradprofile bleiben unverändert.

### Fixed

- **Die Spiegel-Verifikation greift nicht mehr auf kanonische, vom Export
  ausgeschlossene Projektbelege zu.** Der versionierte XLSX-Beleg bleibt in der
  kanonischen Checkout-Prüfung bytegenau abgedeckt; Prüfungen der Originale und
  generierten Publikationsausgaben bleiben ebenfalls kanonisch. Die exportierte
  Testsuite verwendet nur im Spiegel enthaltene Dateien.

## [0.1.22] — 2026-11-07

Korpus-Release mit CBE-Best-Practices. Der CBE Skill **0.4.2** bleibt
unverändert.

### Added

- **Korpus 2026-12 ergänzt elf reale CBE-Best-Practice-Fallstudien und drei
  ausdrücklich fiktive Reifegradprofile.** Die Fallstudien bilden reale Module ab; die drei
  Profile illustrieren getrennt die Reifegrade 1, 2 und 3 und sind klar als
  fiktiv gekennzeichnet.

### Changed

- **Die generierten Korpusartefakte sind auf dem neuen Stand.** Index,
  Download-Bundle und Browse-Ansicht wurden für Korpus 2026-12 regulär neu
  erzeugt.

## [0.1.21] — 2026-11-06

Redaktionelles Korpus-Patch. CBE Skill **0.4.2** und die Korpusversion
**2026-11** bleiben bestehen; App-, Prompt- und Werkzeugverhalten sind
unverändert. Die macOS-Ausgabe bleibt mit Apple Developer ID signiert und
notarisiert; Windows bleibt unsigniert und Linux ein unsigniertes AppImage.
Signierte Skill- und Korpus-Aktualisierungen sind derzeit nicht provisioniert;
sie setzen ein separat freigegebenes späteres Release mit allen Vertrauens- und
Signaturvoraussetzungen voraus.

### Changed

- **Das Korpus-Dokument `foundations-005` enthält den abschliessenden Abschnitt
  „Source discipline“ nicht mehr.** Definition, die sieben PIONEER-Kriterien mit
  ihren Reifegrad-Hinweisen, das Multi-Akteur-Ökosystem, die SDG11-Ausrichtung
  und die erfasste Herkunft aus dem validierten Dokument 4.2.1 bleiben
  wortgleich. Index, Browse-Ansicht und das gebündelte Korpus-Paket 2026-11
  wurden neu erzeugt.

## [0.1.20] — 2026-11-06

Wartungsrelease für Windows, Korpus, Dokumentation und die Quellcode-Spiegelung.
CBE Skill **0.4.2** und die Korpusversion **2026-11** bleiben bestehen; der
Korpus wurde redaktionell bereinigt. Die macOS-Ausgabe bleibt mit Apple
Developer ID signiert und notarisiert; Windows bleibt unsigniert und Linux ein
unsigniertes AppImage. Signierte Skill- und Korpus-Aktualisierungen bleiben in
dieser Version nicht provisioniert.

### Changed

- **Der gebündelte Korpus 2026-11 wurde redaktionell bereinigt.** Zitierte
  Quellen (Sources) und bibliografische Hinweise (References) sind getrennt;
  References tragen keine Lizenzangaben mehr. Das Dokument `foundations-004`
  und alle „Further reading“-Abschnitte wurden entfernt. Im Zitierwerkzeug nennt
  ein Beispiel jetzt eine Quelle, die der Korpus weiterhin zitiert.
- **Die zweisprachige Benutzerdokumentation wurde überarbeitet.**
  Review-Rückmeldungen zu Installation, Fehlerbehebung, Datenschutz, Leitfaden
  und FAQ sind umgesetzt, die Screenshots aktualisiert. Für Hochschul-IT ist ein
  Zwei-Plattformen-Nachweis beschrieben: vollständige Tests unter Linux (auch
  Linux-VM oder WSL im Linux-Dateisystem), natives Windows für Build, Paketierung
  und Installer-Prüfsumme auf demselben Commit. Die vollständige Testsuite ist
  damit ausdrücklich kein nativer Windows-Lauf.
- **Jedes erfolgreiche Release aktualisiert den bereinigten Quellcode-Spiegel
  der Virtuellen Akademie automatisch.** Der Release-Lauf hängt ohne manuellen
  Push genau einen geprüften Snapshot an die saubere v0.1.19-Wurzel des Spiegels
  an; Linux führt dafür die Spiegel-Testspur in einem frischen Klon aus, macOS
  und Windows paketieren unsigniert mit Installer-Prüfsummen.

### Fixed

- **Git-Checkouts erhalten unter Windows LF-Zeilenenden.** Eine
  `.gitattributes`-Regel verhindert CRLF-Dateien aus Git for Windows, die
  Prüfungen, den Build und gepinnte Hashes gebrochen hatten.
- **Signierte Inhaltsaktualisierungen scheitern unter Windows nicht mehr beim
  Sichern der Slot-Dateien.** Die Dateien werden über ein schreibbares Handle
  geflusht, wie Windows es verlangt. Die Korrektur ist Voraussetzung für die
  spätere Aktivierung; in dieser Version bleiben signierte Aktualisierungen
  inaktiv.
- **Die öffentliche Startseite bleibt beim Laden auf ihrer Einleitung**, statt
  zur eingebetteten Dokumentation zu springen.

## [0.1.19] — 2026-11-05

Der gebündelte Korpus und seine generierten Metadaten wurden auf Version
**2026-11** aktualisiert. CBE Skill **0.4.2** bleibt unverändert. Signierte
Skill- und Korpus-Aktualisierungen bleiben in dieser Version nicht provisioniert.

### Changed

- **Der gebündelte Korpus und seine generierten Metadaten wurden aktualisiert.**
  App-, Release-, Signatur-, Notarisierungs-, Updater- und
  Veröffentlichungswege bleiben unverändert.

## [0.1.18] — 2026-10-28

Öffentliche Releases starten jetzt ohne eingebetteten privaten Standard-API-Schlüssel und führen neue Installationen durch die bestehende einmalige Provider-Einrichtung. CBE Skill **0.4.2** und Korpus **2026-07** bleiben unverändert. Die macOS-Ausgabe bleibt mit Apple Developer ID signiert und notarisiert; Windows bleibt unsigniert und Linux ein unsigniertes AppImage.

### Changed

- **Öffentliche Tag- und manuelle Builds sind standardmässig BYO-Provider.** Der Release-Workflow übergibt keinen privaten Standard-Schlüssel mehr an macOS-, Windows- oder Linux-Packaging. Das Packaging entfernt ohne ausdrücklich gesetzte Variable deterministisch jede veraltete generierte Standarddatei; ein separat kontrollierter Opt-in-Build kann den bestehenden Mechanismus weiterhin verwenden.
- **Updates verändern bestehende Modellverbindungen nicht.** Lokale Konfigurationen und verschlüsselte Provider-Schlüssel bleiben bytegenau erhalten; es gibt keine Löschung oder Migration, weil bestehende Datensätze einen früher eingebetteten Schlüssel nicht zuverlässig von einem durch die dozierende Person eingegebenen Schlüssel unterscheiden. Eine v0.1.17-Installation kann den bisherigen lokal gespeicherten Zugang deshalb behalten, bis der Provider-Verantwortliche diesen Schlüssel separat widerruft.

### Security

- **Der private Standard-Schlüssel ist aus dem öffentlichen CI-Pfad entfernt.** Deterministische Tests halten fest, dass öffentliche Packaging-Jobs keinen Default-Provider-Schlüssel erhalten, während die Apple-Signatur- und Notarisierungsgeheimnisse weiterhin ausschliesslich im geschützten macOS-Job liegen. Windows und Linux erhalten weder diese Geheimnisse noch eine Signatur.

## [0.1.17] — 2026-10-28

Erstes signiertes und notarisiertes öffentliches Release. CBE Skill **0.4.2**
und Korpus **2026-07** bleiben unverändert. Die macOS-Ausgabe ist mit einer
Apple Developer ID signiert und notarisiert; Windows bleibt unsigniert und kann
weiterhin eine SmartScreen-Warnung zeigen. Linux bleibt ein unsigniertes
AppImage mit veröffentlichter SHA256-Prüfsumme.

### Added

- **Eine öffentliche, PIONEER-nahe Landingpage bündelt Dokumentation und
  Download.** Sie veröffentlicht die zweisprachige Dokumentation und den
  aktuellen Installer ohne Projektstatus, Review-Steuerung oder geschützte
  Portal-Inhalte.
- **Dokumentation und Download lassen sich dynamisch in Partnerseiten
  einbetten.** Beide Komponenten rendern in gekapseltem Light DOM, übernehmen
  Typografie und Farben der Host-Seite und behalten ihre stabilen
  Sprach-, Ziel- und Download-Verträge.

### Changed

- **macOS-Releases werden automatisiert mit Developer ID signiert und von Apple
  notarisiert.** Die CI prüft App, DMG und ZIP vor der Veröffentlichung mit
  `codesign`, Gatekeeper, Stapler und `notarytool`; fehlende oder ungültige
  Signaturdaten brechen den macOS-Build ab. Windows- und Linux-Builds erhalten
  keinen Zugriff auf diese Apple-Geheimnisse.

### Fixed

- **Die v0.1.16-Veröffentlichung installiert ihre Abhängigkeiten vor der
  Release-Vorbereitung.** Metadaten- und Dokumentationsprüfungen können dadurch
  im vorbereitenden CI-Job zuverlässig ausgeführt werden.

## [0.1.16] — 2026-10-28

Geschlossener Test-Build (Pre-Release, weiterhin **unsigniert**). Diese Version
führt die freigegebene Summit-Bildmarke, native Anwendungsmenüs und die
zweisprachige Benutzerdokumentation ein. Sie enthält weiterhin CBE-Skill
**0.4.2** und Korpus **2026-07**; beide Inhaltsversionen bleiben unverändert.

### Added

- **Die CBE Toolbox trägt jetzt die freigegebene Summit-Bildmarke.** Aus der
  geprüften Quelldatei werden die macOS-, Windows- und Linux-Symbole sowie das
  Laufzeitsymbol deterministisch erzeugt und vor dem Build auf Vollständigkeit
  und Byte-Aktualität geprüft. Das Symbol schafft visuelle Identität; die
  Installer bleiben unsigniert und nicht notarisiert.
- **Minimale native Anwendungsmenüs ergänzen die Oberfläche.** Die Menüs folgen
  der eingestellten Oberflächensprache und bieten die üblichen Datei-,
  Bearbeitungs-, Ansichts- und Fensteraktionen sowie Wege zu Einstellungen,
  App-Informationen und Hilfe. In der Informationsgruppe und im Hilfemenü führt
  ein lokalisierter Link zur offiziellen Website der PIONEER Alliance; er öffnet
  ausschliesslich diese feste Adresse im Systembrowser.
- **Eine zweisprachige Benutzerdokumentation liegt als Markdown im Repository.**
  Der englische und deutsche Review-Entwurf umfasst Schnellstart, Leitfaden,
  Installation und lokale IT, Fehlerbehebung, Datenschutz und Ablage,
  Barrierefreiheit sowie Glossar/FAQ. Deterministische Prüfungen halten Struktur,
  Quellen, Übersetzungsparität und reale Electron-Screenshots aktuell. Dies ist
  noch keine öffentlich gehostete Dokumentationsseite und keine abschliessende
  redaktionelle Freigabe.

### Changed

- **Das paketierte macOS-Programm heisst `CBE Toolbox.app`.** Es verwendet damit
  den bestehenden Produktnamen aus der Paketkonfiguration. `npm run dev` bleibt
  dagegen der electron-vite-Entwicklungsstart und kann in Finder weiterhin als
  `Electron` erscheinen; er wird nicht in eine paketierte App umbenannt.

### Fixed

- **Intern: Entwicklungseinstellungen bleiben an ihrem bisherigen Speicherort.**
  Bestehende lokale Konfigurationen und Kurse werden nach einem Entwicklungsstart
  weiterhin aus demselben Profil geladen.
- **Das Summit-Symbol erscheint im macOS-Entwicklungsstart zuverlässig.** Es wird
  nach der Electron-Bereitschaft aus dem geprüften Laufzeit-PNG gesetzt; die
  paketierte App bezieht ihre Identität weiterhin aus dem ICNS-Bundle.

## [0.1.15] — 2026-10-18

Geschlossener Test-Build (Pre-Release, weiterhin **unsigniert**). Schwerpunkte:
Formulierungshilfe auf Zustimmung statt Textsorten-Verboten und eine bleibende
Unterstützungspräferenz; CBE-Skill **0.4.2** (mitgeliefert und über den
Portal-Kanal verteilt); die Oberfläche in vier Sprachen samt Sprachwahl in der
Kopfleiste; eine ruhigere Arbeitsanzeige während einer Antwort; Excel- und
CSV-Dateien als Material; und eine neue Laufzeit der Assistenz (Pi 1.3) hinter
einer CBE-eigenen Grenze. Die Regeln von Skill 0.4.2 sind modellfrei
abgesichert; eine Live-Modell-Messung liegt für sie nicht vor.
Linux wird als AppImage mitgebaut, ist aber auf keiner Version getestet.

### Added

- **Die Assistenz formuliert Kurstexte mit Ihnen — wenn Sie darum bitten oder
  ein Angebot annehmen.** Lernergebnisse, Kompetenzen, Big Idea, Challenge,
  Prüfung, Bewertungsraster oder Ablaufplan: Auf Ihren ausdrücklichen Wunsch
  oder Ihr Ja zu einem Angebot entwirft sie den Text der aktuellen Komponente,
  auf Wunsch vollständig. Sie arbeitet dabei schrittweise — fasst zusammen, was
  sie verstanden hat, legt einen Entwurf vor, benennt Lücken und Annahmen, bittet
  um Korrektur oder Annahme und schärft nach; eine angenommene Formulierung gilt
  als Ihre Entscheidung. Die bisherigen Verbote einzelner Textsorten für das
  eigene Modul entfallen. Was bleibt: Ungefragt formuliert sie nichts für Ihren
  Kurs, und Erfundenes — Anspruchsgruppen, Bedarfe, Rahmenbedingungen, Belege —
  stellt sie nie als feststehend dar, sondern lässt eine benannte Lücke, eine
  Annahme oder einen Platzhalter stehen.

- **Wie viel Unterstützung Sie möchten, bleibt jetzt über Gespräche und Kurse
  hinweg erhalten.** Sie können der Assistenz sagen, ob sie Schritt für Schritt
  führen, an Ihrem eigenen Entwurf mitarbeiten oder knapp bleiben soll; diese
  Präferenz gilt für alle Ihre Kurse, bis Sie sie ändern oder löschen. Hat sie
  noch keine, fragt die Assistenz einmal danach — an der ersten Übergabe einer
  Komponente, nicht als Fragebogen — und fragt unbeantwortet nicht erneut. Eine
  Präferenz ist kein Auftrag, Kursinhalte zu formulieren. Ändern Sie sie in
  einem Gespräch, erfahren bereits offene Gespräche das beim nächsten Zug. Die
  Präferenz liegt lokal in Ihrem App-Datenprofil, getrennt von der
  geschätzten Einordnung Ihres Profils.

- **Die Assistenz richtet den nächsten Schritt nach dem aktuellen Arbeitsanliegen aus, ohne einen Modus abzufragen oder anzuzeigen.** Ein klarer Auftrag zum Entwerfen eines Moduls, zum Übertragen bestehender Lehre in CBE oder zu einer begrenzten kritischen Prüfung erhält jeweils den passenden ersten Arbeitsschritt. Nur wenn unterschiedliche Lesarten die nächste Handlung tatsächlich verändern würden, folgt eine einzelne, konkrete Rückfrage; sonst beginnt die Arbeit direkt am genannten Einstiegspunkt. Ein ausdrücklicher Prüfauftrag wird sofort bearbeitet. Ändert sich das Anliegen im Gespräch, folgt die Assistenz im selben Zug, ohne Karten oder Zielsetzung zurückzusetzen oder die vorherige Arbeit erst abschliessen zu lassen. Beim Weiterarbeiten an einem bestehenden Kurs knüpft sie an dessen tatsächlich festgehaltenem Stand an.

- **Beim ersten Öffnen des arbeitsbereiten Gesprächs erklärt eine kompakte Karte die Toolbox, ohne den Einstieg zu blockieren.** Sie ordnet die Arbeit einem Kurs zu, zeigt, wo Kurse erstellt, gewechselt und verwaltet werden und wo deren gespeicherte Gespräche und Wiki liegen. Sie erklärt ausserdem den Unterschied zwischen wiederverwendbarem Wiki-Wissen aus importiertem Kursmaterial und einem Anhang für das aktuelle Gespräch sowie die Rollen von Gespräch, CBE Process Canvas und CBE Maturity. Die Eingabe bleibt währenddessen benutzbar; Beginnen, Überspringen oder die erste angenommene Nachricht schliessen die Karte, ohne Text vorzugeben oder eine zusätzliche Modellanfrage auszulösen. Die Entscheidung gilt einmalig für das lokale App-Datenprofil, unabhängig von Kurs, Modellverbindung und Aktualisierung. Zum späteren Nachlesen liegt dieselbe Übersicht in der Informationsgruppe mit den installierten Versionsangaben im Einstellungs-Overlay hinter dem Zahnrad oben rechts. Sämtliche Texte und Bedienhilfen folgen der gewählten Oberflächensprache.

- **Die Oberflächensprache lässt sich jetzt direkt in der Kopfleiste wechseln.**
  Links neben dem Fragezeichen sitzt eine schmale Sprachwahl — ein Globus, das
  Kürzel der aktiven Sprache und ein Pfeil —, die jede mitgelieferte Sprache
  unter ihrem eigenen Namen anbietet ("Deutsch", "English", "Français",
  "Italiano"). Sie ist das einzige Bedienelement oben rechts, das schon **vor**
  der Einrichtung der Modellverbindung da ist: Wer die App in einer Sprache
  vorfindet, die er nicht liest, kommt damit auch aus der Einrichtungsansicht
  heraus, ohne zuerst die Einstellungen finden zu müssen. Fragezeichen, Zahnrad
  und Profil bleiben unverändert an ihrem Platz und behalten ihre bisherigen
  Bedingungen; die Kopfleiste wird nicht höher und die Mindestbreite des
  Fensters nicht grösser. Die Sprachwahl in der Darstellungs-Gruppe der
  Einstellungen bleibt ebenfalls erhalten — beide Wege stellen dieselbe
  Einstellung, wirken sofort und zeigen einander an, ohne Speichern und ohne
  Neustart. Bedienbar ist die Liste vollständig mit der Tastatur (öffnen mit
  Eingabe-, Leer- oder Pfeiltaste, wandern mit den Pfeiltasten und
  Anfang/Ende, Springen durch Tippen der ersten Buchstaben; Escape schliesst,
  ohne etwas zu ändern), und für Screenreader nennt sie Zweck, aktuelle Sprache
  und Zustand. **Nicht betroffen:** das offene Gespräch, ein angefangener Text
  samt Anhängen, eine ungespeicherte Einstellung — und die Antwortsprache der
  Assistenz, die weiterhin der Sprache folgt, in der geschrieben wird.

- **Excel-Arbeitsmappen (`.xlsx`) lassen sich jetzt einlesen.** Ein Stundenplan
  oder eine Notenliste kommt damit als Tabelle beim Assistenten an — über das
  "+"-Menü am Eingabefeld ebenso wie beim Einlesen ins Wiki eines Kurses. Dabei
  bleibt erhalten, worauf es bei einer Tabelle ankommt: **jedes Arbeitsblatt**
  wird unter seinem eigenen Namen und seiner Position ausgegeben (ausgeblendete
  Blätter eingeschlossen und als solche gekennzeichnet), **Zeilen und Spalten**
  behalten die Nummern und Buchstaben, die auch in Excel stehen, sodass eine
  Zelle weiterhin ihre Adresse hat, und **leere Zellen bleiben leere Positionen**,
  statt zu verschwinden — eine übersprungene Zelle würde jede folgende um eine
  Spalte verschieben. **Formeln** erscheinen mit dem Ergebnis, das Excel
  anzeigt (fehlt es in der Datei, mit der Formel selbst), **Datumszellen** als
  lesbares Datum statt als fünfstellige Zahl, und **verbundene Zellen** werden
  über alle abgedeckten Felder wiederholt und zusätzlich als Bereich benannt, so
  dass die Wiederholung sichtbar und rückgängig zu machen ist. Sehr grosse
  Mappen werden begrenzt gelesen (64 Spalten je Blatt, 10.000 Zellen je Mappe);
  **jede Kürzung wird im übergebenen Text benannt**, samt der Blätter, die nicht
  mehr an die Reihe kamen — eine halb gelesene Datei soll nicht wie eine ganze
  aussehen. Ältere und makrofähige Excel-Formate (`.xls`, `.xlsb`, `.xlsm`)
  nimmt die App weiterhin nicht an; sie werden jetzt aber ausdrücklich als das
  benannt, was sie sind, mit dem Hinweis, die Mappe einmal als `.xlsx` zu
  speichern.

- **CSV-Dateien lassen sich jetzt einlesen.** Neben den bisher unterstützten
  Formaten nimmt die App auch `.csv` an — über das "+"-Menü am Eingabefeld
  ebenso wie beim Einlesen ins Wiki eines Kurses. Die Datei wird dabei
  unverändert übergeben: nichts wird umsortiert, neu getrennt oder in eine
  andere Tabellenform gebracht, sodass ein Stundenplan genau so beim Assistenten
  ankommt, wie er exportiert wurde — mit Semikolon getrennte Exporte
  eingeschlossen.

- **Die Oberfläche gibt es jetzt auch auf Französisch und Italienisch.** Im
  Einstellungsbereich des Overlays hinter dem Zahnrad oben rechts stehen in der
  Gruppe für das Erscheinungsbild damit vier Sprachen zur Wahl, jede unter ihrem
  eigenen Namen ("Deutsch", "English", "Français", "Italiano"). Wer die
  App zum ersten Mal auf einem System mit französischer oder italienischer
  Spracheinstellung startet, sieht sie sofort in dieser Sprache — ohne etwas
  einzustellen. Übersetzt ist alles, was die App selbst schreibt: Beschriftungen,
  Menüs, Tooltips, Platzhalter, leere Zustände, Bestätigungs- und Fehlertexte,
  die Überschriften des exportierten Designdokuments und die Texte, die für
  Screenreader gedacht sind. Zahlen und Datumsangaben folgen der gewählten
  Sprache. Wie schon bei Deutsch gilt: **die Antwortsprache der Assistenz ist
  davon nicht betroffen** — sie antwortet weiterhin in der Sprache, in der
  geschrieben wird, und nennt Schaltflächen dabei so, wie sie auf dem Bildschirm
  stehen. Die Wahl gilt sofort und bleibt nach dem Beenden erhalten.

- **Die Oberflächensprache lässt sich einstellen — Deutsch und Englisch.** Im
  Einstellungsbereich des Overlays hinter dem Zahnrad oben rechts steht in der
  Gruppe für das Erscheinungsbild eine Sprachwahl; jede Sprache nennt sich mit
  ihrem eigenen Namen ("Deutsch", "English"), damit sie auch
  findet, wer gerade in einer Sprache gelandet ist, die er nicht liest. Beim
  ersten Start richtet sich die App nach der Sprache des Betriebssystems und
  fällt auf Englisch zurück, wenn dafür keine Übersetzung mitgeliefert wird. Die
  Wahl wirkt sofort auf die gesamte Oberfläche — ohne Neustart, ohne dass das
  offene Gespräch, der CBE Process Canvas, die CBE-Maturity-Einschätzung oder
  ein laufender Zug angetastet werden — und bleibt nach dem Beenden erhalten.
  Zahlen und Datumsangaben folgen der eingestellten Sprache statt der
  Systemeinstellung; wer bei Englisch bleibt, sieht keinerlei Veränderung.
  **Was die Einstellung ausdrücklich nicht steuert:** die Sprache der Assistenz.
  Sie antwortet weiterhin in der Sprache, in der geschrieben wird — auch wenn
  die Oberfläche eine andere hat. Nennt sie dabei eine Schaltfläche, nennt sie
  diese so, wie sie auf dem Bildschirm steht, während der Satz drumherum in der
  Sprache der schreibenden Person bleibt. Jede weitere Sprache braucht künftig
  nur noch je eine Katalogdatei.

- **Hilfe ist jetzt oben rechts im Fenster erreichbar.** Ein Fragezeichen in
  der Kopfleiste neben Einstellungen und Profil schickt dieselbe Hilfe-Anfrage
  wie der Eintrag im "+"-Menü des Eingabefelds — beide Wege bleiben, und beide
  lösen genau dieselbe Antwort aus. Der angefangene Text und angehängte
  Dokumente bleiben unberührt. Während der Assistent arbeitet, sagt das
  Fragezeichen das statt zu reagieren; vor der Einrichtung der Modellverbindung
  wird es wie Zahnrad und Profil noch nicht angezeigt.

- **Inhalte aktualisieren sich jetzt über das Projekt-Portal.** Korpus und
  CBE-Skill gleichen sich gegen das bestehende Portal ab: Die App prüft beim
  Start (der Korpus zusätzlich über die Aktualisierungsschaltfläche in der
  Korpus-Gruppe der Einstellungen), ob eine neuere Version bereitsteht,
  verifiziert jeden Download vor dem Entpacken gegen seine Prüfsumme und übernimmt nur geprüfte Inhalte — ein
  fehlgeschlagener Abgleich lässt den geladenen Stand unangetastet. Ein
  übernommener Skill gilt für neue Sitzungen; laufende Sitzungen behalten
  ihren Stand. Der Kanal ist durch einen mitgelieferten Zugriffsschlüssel
  geschützt; ohne Netz arbeitet die App unverändert mit dem zuletzt
  abgeglichenen Stand weiter.

### Changed

- **Mitgelieferter CBE-Skill 0.4.2** (bisher 0.3.0). Er bündelt drei Schritte:
  die Ausrichtung am aktuellen Arbeitsanliegen (0.4.0, siehe oben), die Nutzung
  bereits gelieferter Angaben vor dem Intake (0.4.1, siehe unten) und die
  Formulierungshilfe auf Zustimmung mit Unterstützungspräferenz (0.4.2). Derselbe
  Stand liegt im Portal-Kanal, sodass eine App mit älterem Skill ihn für neue
  Gespräche übernimmt; laufende Gespräche behalten ihren Stand. Welche
  Skill-Version aktiv ist, zeigt die Informationsgruppe im Einstellungs-Overlay
  hinter dem Zahnrad oben rechts.

- **Bereits gelieferte Angaben werden vor dem Intake genutzt statt erneut
  erfragt.** Nennen Sie zu Beginn Ihr Anliegen, die angestrebte Ambition oder
  dass noch kein Material vorliegt, arbeitet die Assistenz damit weiter, statt
  dieselben Angaben im allgemeinen Einstieg noch einmal abzufragen. Eine
  beantwortete Rückfrage führt die Arbeit am Material weiter, statt das Intake
  neu zu beginnen; legen Sie die Gesamtambition fest, hält die Assistenz sie
  nach den Skill-Regeln im selben Zug als Ziel in CBE Maturity fest.

- **Intern: neue Laufzeit der Assistenz (Pi 1.3), gekapselt hinter einer
  CBE-eigenen Grenze.** Die eingebettete Agent-Laufzeit wurde von 0.75.5 auf
  1.3.0 gehoben. App, Oberfläche und Auswertung sprechen sie nur noch über eine
  CBE-eigene Schnittstelle an; Einstellungen, Modellzugang und Ressourcen sind je
  Sitzung ausdrücklich gesetzt, und es werden keine Laufzeit-Konfigurationsdateien
  von der Festplatte gelesen. Ein Zug gilt erst als beendet, wenn die Laufzeit
  ihn tatsächlich abgeschlossen hat — auch nach automatischen Wiederholungen —,
  sodass die Abschlussschritte der App nicht mehr zu früh greifen. Die
  Anfrage an das Modell bleibt dabei bis auf drei bekannte Details des
  Werkzeugschemas byte-gleich zur bisherigen. Künftige Laufzeit-Sprünge müssen
  zuerst ein eigenes Kandidaten-Gate mit benannten Verträgen an dieser Grenze
  bestehen, bevor sie die App erreichen.

- **Während einer laufenden Antwort bündelt eine einzige kompakte Anzeige
  "Arbeitet…" die technische Aktivität.** Sie steht ruhig am Anfang des laufenden
  Zuges, solange noch kein sichtbarer Antworttext da ist. Mit dem ersten Text
  verschwindet die geschlossene Anzeige, statt von der wachsenden Antwort immer
  weiter nach unten geschoben zu werden; wer sie zuvor bewusst geöffnet hat,
  behält sie für diesen Zug oben angeheftet. Solange sie geschlossen ist, steckt
  im Gespräch kein verborgener Werkzeug- oder Gedankengang-Teilbaum — er wird
  nicht bloss unsichtbar gemacht, sondern gar nicht angelegt. Öffnen Sie sie,
  sehen Sie die Aktivität des laufenden Zuges in ihrer echten Reihenfolge und
  können sie kopieren; Rohfehlertexte bleiben davon ausgenommen. Die Anzeige ist
  ein echter tastaturbedienbarer Knopf: Escape schliesst sie, und der Fokus kehrt
  danach verlässlich zu ihr zurück. Automatische Wiederholungen und das
  Zusammenfassen des Verlaufs nutzen dieselbe Anzeige statt eigener
  Hinweisstreifen. Fragen mit Auswahlkarte und die verbliebene
  Entscheidungs-Checkliste bleiben ausserhalb davon sichtbar und bedienbar. Mit
  dem Ende der Antwort verschwinden Anzeige und technische Details aus dem
  Gespräch; die vollständige lokale Diagnosespur bleibt für die Fehlersuche
  unverändert erhalten.

- **Intern: der Platz für die App-Referenz im Hilfe-Prompt wurde von 17.000 auf
  18.000 Zeichen angehoben.** Die App schickt der Assistenz bei einer
  Hilfe-Anfrage eine Liste ihrer eigenen Bedienelemente mit; deren Beschriftungen
  stehen in der eingestellten Sprache, und italienische Beschriftungen sind
  länger als englische. Gemessen mit allen Flächen: Englisch 16.694, Deutsch
  16.812, Französisch 16.822, Italienisch 16.843 Zeichen. Alle vier passten zwar
  noch unter die alte Grenze, Italienisch aber nur um 157 Zeichen — und wer diese
  Grenze überschreitet, verliert ganze Einträge stillschweigend, sodass die
  Assistenz ein real vorhandenes Bedienelement für nicht existent hält. Es wurde
  deshalb kein Eintrag gekürzt, sondern die Grenze neu gesetzt; sie hat nun in
  der längsten Sprache wieder Platz für rund zwei weitere Einträge.

- **Die Oberfläche spricht durchgehend Englisch.** Die Bedienelemente rund um
  das Eingabefeld — das "+"-Menü mit "Upload files" und "Help", der
  Senden-/Stopp-Knopf, die Modell-Anzeige, die Anhang-Chips — sprachen bisher
  als einzige Fläche Deutsch, während die App daneben Englisch beschriftet war.
  Diese Ausnahme ist aufgehoben: Jede Beschriftung, die die App selbst schreibt,
  ist jetzt Englisch, auch in der CBE-Process-Canvas-Ansicht ("↻ Iterate",
  "+ Note") und in den Meldungen beim Einlesen von Material. **Die Sprache des
  Assistenten ändert sich nicht** — er antwortet weiterhin in Ihrer Sprache.
- **Das Eingabefeld ist ruhiger geworden.** Die Hinweiszeile unter dem Feld
  ("Enter senden · Shift+Enter neue Zeile" bzw. die Statuszeile während einer
  laufenden Antwort) und der Platzhaltertext im Feld sind entfallen: Beide haben
  wiederholt, was ohnehin sichtbar ist. Dass der Assistent gerade arbeitet,
  zeigen weiterhin der abgetönte Rahmen, der Stopp-Knopf an der Stelle des
  Senden-Knopfs und — bis der erste Antworttext sichtbar ist — die Arbeitsanzeige
  im Gesprächsverlauf.

### Security

- **Dateischreibzugriffe des Assistenten sind jetzt technisch eingezäunt.**
  Die Werkzeuge, mit denen der Assistent Dateien anlegt oder ändert, greifen
  nur noch in ausdrücklich freigegebene Orte: den Arbeitsbereich, das Wiki des
  aktiven Kurses und die beiden Lecturer-State-Dateien. Alles andere — etwa
  gespeicherte Konversationen, die App-Konfiguration oder Dateien ausserhalb
  der App — wird vor jedem Schreibversuch abgewiesen, ohne Nebenwirkung und
  mit sichtbarer Begründung statt vorgetäuschtem Erfolg. Auch die
  Wiki-Ingestion schreibt nur noch in den Wiki-Ordner des Kurses; eingebettete
  Anweisungen in hochgeladenen Dokumenten können die Freigaben nicht erweitern.

### Fixed

- **Neu eingelesene Wiki-Atome erscheinen ohne Neuladen.** War das Wiki eines
  Kurses beim Ende eines Ingests nicht mehr dieselbe Ansicht — weil das Panel
  zwischendurch eingeklappt, der Tab gewechselt oder ein anderer Kurs aktiviert
  worden war —, zeigte die Wiki-Liste die neuen Atome erst nach einem erneuten
  Öffnen. Jetzt aktualisiert sich die gerade sichtbare Wiki-Ansicht des Kurses,
  in dem der Ingest lief, sobald er endet; andere Kurse bleiben unberührt.
- **Ein frischer Entwurf zeigt Schritt 1 sofort im Fokus.** Beim neuen Kurs und
  beim Wiederöffnen eines Kurses, an dem noch nichts festgehalten ist, steht
  Schritt 1 im CBE Process Canvas von Anfang an im Fokus — vor der ersten
  Antwort der Assistenz. Dieser Fokus ist reine Orientierung: Er zählt nicht als
  bearbeiteter Schritt und wird nicht als Kursstand gespeichert. Kurse mit
  festgehaltener Arbeit und "New Session" behalten ihren Stand unverändert.
- **Das Eingabefeld bleibt unten.** Nach dem Überspringen der Einstiegskarte
  rutschte das Eingabefeld an den oberen Rand des Gesprächs. Es steht jetzt in
  jedem Zustand unter dem Gesprächsverlauf — mit und ohne Einstiegskarte, bei
  leerem und langem Verlauf, eingeklappten Panels, schmalem Fenster und
  vergrösserter Schrift —, und Verlauf und Eingabefeld überlappen sich auch bei
  200 % Zoom nicht mehr.
- **Ein Kurswechsel wirkt nicht mehr auf den zuvor geöffneten Kurs.** Wechselte
  man in einen Kurs ohne geöffnetes Gespräch — oder scheiterte das Öffnen
  seines Gesprächs —, zeigten die Bedienelemente noch auf das Gespräch des
  vorherigen Kurses: Eine angeforderte Maturity-Einschätzung oder ein Klick auf
  einen Schritt konnten unsichtbar dort landen. Beim Wechsel wird jetzt der
  gesamte Gesprächszustand geleert; "New Session" übernimmt weiterhin wie
  vorgesehen den Stand des Kurses.
- **Technische Endmarken eines Modells erscheinen nicht mehr als Teil der
  Antwort.** Manche OpenAI-kompatiblen Backends liefern sporadisch einen
  Chat-Protokollmarker wie `<turn|>` im normalen Textstrom mit. Die App hält
  mögliche Endmarken nun bis zum Nachrichtenende zurück und entfernt nur
  bestätigte Protokoll-Enden — auch wenn sie über mehrere Streaming-Pakete
  verteilt eintreffen. Derselbe Text mitten in einer Erklärung und unbekannte
  Klammerausdrücke bleiben unverändert. Bereits gespeicherte betroffene Gespräche
  öffnen ohne die Endmarke; die rohe lokale Pi-Diagnosespur bleibt zur
  Ursachenanalyse vollständig erhalten.
- **Ein vom Modell sofort korrigierter Picker-Fehler erscheint nicht mehr neben
  der funktionierenden Frage.** Solange die Assistenz noch arbeitet, bleibt ein
  abgewiesener oder strukturell ungültiger Picker in der technischen
  „Arbeitet…“-Detailansicht. Liefert sie danach im selben Zug einen gültigen
  Picker, verschwindet der Fehlversuch aus dem normalen Gespräch. Endet der Zug
  dagegen ohne gültigen Ersatz, bleibt genau ein sicherer Hinweis für den
  letzten ungelösten Fehlversuch sichtbar — ohne Rohfehler oder doppelte
  Meldungen. Zu grosse Picker blitzen ausserdem nicht mehr kurz auf, bevor die
  Schema-Prüfung sie ablehnt.
- **Die Meldungen der Korpus-Aktualisierung sprechen jetzt durchgehend die
  eingestellte Sprache.** Schlug eine Aktualisierung fehl, stand in der Meldung
  bisher ein englischer Satz aus dem Inneren der App — bei deutscher, französischer
  oder italienischer Oberfläche also ein Sprachgemisch —, und im schlimmsten Fall
  der rohe Fehlertext einer Bibliothek oder des Betriebssystems. Jede Meldung
  kommt jetzt aus dem Sprachkatalog der Oberfläche, in allen vier Sprachen, und
  benennt dabei den Grund: keine Aktualisierungsquelle für diesen Build
  hinterlegt, die Aktualisierungsinformation nicht erreichbar oder unvollständig,
  der Download fehlgeschlagen, dem Paket fehlt die erforderliche Datei oder es
  enthält einen abgewiesenen Eintrag, oder die Installation ist fehlgeschlagen.
  Kommt etwas Unerwartetes zurück, steht dort ein verständlicher Hinweis statt
  einer leeren Zeile oder eines Fehlerobjekts; die technischen Einzelheiten
  gehen ins Protokoll, damit ein Fehlerbericht weiterhin auswertbar bleibt.
  Versionsnummern, HTTP-Codes und Dateinamen bleiben unverändert als Angabe
  stehen und werden nicht übersetzt. Wird die Sprache gewechselt, während eine
  Meldung steht, wechselt sie sofort mit — ohne dass erneut nach einer
  Aktualisierung gesucht wird. Und scheitert nach einer erfolgreichen
  Aktualisierung nur das erneute Auslesen der Korpus-Angaben, wird daraus nicht
  mehr eine gescheiterte Aktualisierung: Das Ergebnis bleibt stehen, mit einem
  zusätzlichen Hinweis auf die nicht gelesenen Angaben.
- **Der Assistent kennt jetzt die Formate, die die App wirklich annimmt.** Er
  wusste bisher nicht, welche Dateien eingelesen werden können, und riet
  deshalb schon einmal dazu, eine Excel-Tabelle als CSV zu speichern — was die
  App dann ebenfalls ablehnte. Welche Formate angenommen werden, gehört jetzt zu
  dem, was ihm zu Sitzungsbeginn über die App mitgeteilt wird, und stammt aus
  derselben Quelle wie der Hinweis am "+"-Menü und die Meldung bei einer
  abgewiesenen Datei.
- **Umlaute aus Textdateien mit Windows-Kodierung bleiben erhalten.** Eine
  `.txt`-, `.md`- oder `.csv`-Datei, die nicht als UTF-8 gespeichert war — etwa
  ein CSV-Export aus einem deutschsprachigen Excel oder ein als ANSI
  gespeichertes Notepad-Dokument —, kam bisher mit zerstörten Umlauten an.
  Solche Dateien werden jetzt erkannt und richtig gelesen, und ein
  vorangestelltes Byte-Order-Mark (Excels "CSV UTF-8") landet nicht mehr im
  Text. Korrekt als UTF-8 gespeicherte Dateien verhalten sich unverändert.
- **Der deutsche Hinweis auf fehlerhafte Wiki-Dateien stimmt jetzt auch bei
  genau einer.** Er lautete "1 Datei(en) … haben die Atom-Validierung nicht
  bestanden" und stand damit im Plural, obwohl nur eine einzige Datei betroffen
  war; jetzt heisst es im Singular "1 Datei … hat" und im Plural "3 Dateien …
  haben".
- **Eingelesenes Material landet nicht mehr im falschen Kurs.** Die
  Detailansicht eines Kurses bot bisher auch dann "Ingest material" an, wenn
  dieser Kurs gar nicht der aktive war — das Material wurde dann in den aktiven
  Kurs eingelesen. Eingelesen wird jetzt ausschliesslich im aktiven Kurs: eine
  nicht-aktive Kursansicht bietet den Knopf nicht mehr an, sondern weist darauf
  hin, dass der Kurs dafür aktiviert werden muss, und die App weist einen
  Ingest, der auf einen anderen als den aktiven Kurs zeigt, mit Begründung ab —
  bevor eine Datei kopiert wird. Ein bereits **laufender** Ingest bleibt an
  seinen Kurs gebunden: Wird währenddessen ein anderer Kurs aktiviert, läuft er
  dort weiter, wo er gestartet wurde, bleibt auf der Ansicht seines eigenen
  Kurses mit Fortschritt und Abbrechen sichtbar, und im neu aktivierten Kurs
  kann parallel eingelesen werden. Abbrechen beendet nur den gemeinten Lauf und
  nie den eines anderen Kurses.
- **Was der Assistent an Ihrem Kursentwurf festgehalten hat, steht jetzt im
  gespeicherten Gespräch.** Die Canvas-, Schritt- und Maturity-Aufrufe eines Zuges
  waren im Sitzungsprotokoll nirgends vermerkt; sie werden nun zum Zug
  mitgeschrieben, und das Markdown-Archiv nennt die festgehaltenen Aktionen in
  einer eigenen Zeile. Ältere Gespräche bleiben unverändert lesbar. Im Gespräch
  selbst sind technische Karten dagegen nur noch während der laufenden Antwort
  sichtbar, in der Anzeige "Arbeitet…" (siehe oben): ein wiedergeöffnetes Gespräch
  zeigt Ihren Text und Ihre Fragekarten, nicht die technischen Karten. Canvas,
  Schritte und Maturity-Raster kommen weiterhin aus dem gespeicherten Kursstand.

## [0.1.14] — 2026-08-20

### Added

- **Testbuilds starten vorkonfiguriert.** Ein Release-Build kann den
  LLM-Zugang gleich mitbringen: Beim Paketieren wird ein hinterlegter
  API-Schlüssel eingebettet, und eine frische Installation startet mit
  OpenRouter, dem Modell `google/gemma-4-31b-it`, Reasoning an (medium) und
  131072 Token Kontext — der Konfiguration, gegen die das Werkzeug entwickelt
  und gemessen wird. Die Werte stehen in den Einstellungen wie selbst
  eingetragene und lassen sich dort ändern oder löschen; eine bestehende
  Konfiguration wird nie überschrieben, auch nicht beim Update. Ohne
  hinterlegten Schlüssel verhält sich der Build wie bisher.

## [0.1.13] — 2026-08-20

### Fixed

- **Die Chats-Liste folgt der offenen Konversation des Kurses.** Nach New
  Session oder dem Wiederaufnehmen eines gespeicherten Gesprächs blieb die
  Markierung auf der alten Zeile stehen, und ein frisch begonnenes Gespräch
  fehlte in der Liste. Die Markierung leitet sich jetzt aus der im Store
  gehaltenen Session-Identität des Kurses ab, und ein Wechsel dieser Identität
  liest die Liste neu.
- **Die Chats-Liste hält eine stabile historische Reihenfolge.** Das
  Wiederaufnehmen eines Gesprächs schob die angeklickte Zeile an die Spitze,
  weil nach dem Aktivitätsstempel sortiert wurde. Sortiert wird jetzt nach dem
  Erstellungsdatum (neueste Erstellung zuerst), und die Zeile zeigt dieses
  Datum; nur Markierung und Fokus wandern. Nebenbefund behoben: Gespräche, deren
  Frontmatter-Zeitstempel der Parser als Datum lieferte, trugen kein Datum und
  fielen ans Ende der Liste.
- **Die Zeile der offenen Konversation aktualisiert sich, während das Gespräch
  läuft.** Anfangsausschnitt und Zug-Anzahl der offenen Zeile kommen live aus
  dem Gesprächsstand statt aus dem einmaligen Lesen beim Öffnen der Liste; alle
  anderen Zeilen bleiben unverändert.
- **Das Wiki-Suchfeld ist vom Tab-Trenner abgesetzt** — derselbe Abstand wie
  bei der Chats-Liste.

## [0.1.12] — 2026-08-20

### Added

- **Gespeicherte Gespräche eines Kurses lassen sich aus dem Chats-Tab
  wiederaufnehmen.** Die Detailansicht eines Kurses trägt neu zwei Tabs, Chats
  und Wiki. Chats listet die gespeicherten Gespräche des Kurses, neueste zuerst,
  mit Datum, Anfangsausschnitt und Zug-Anzahl; das aktuell offene ist markiert.
  Ein Klick auf eine Zeile öffnet dieses Gespräch als das eine offene Gespräch
  des Kurses — Canvas, Schritt-Fortschritt, Maturity-Einschätzung und
  Entscheidungen kommen aus dem gespeicherten Stand mit, und die Wahl übersteht
  einen Neustart der Anwendung. Es bleibt bei einem offenen Gespräch pro Kurs;
  die Liste wechselt nur, welches das ist. Während die Assistenz in dem Kurs
  arbeitet, sind die Zeilen mit benanntem Grund gesperrt, und ein gespeichertes
  Gespräch ohne lesbaren Verlauf bleibt gelistet, aber nicht wiederaufnehmbar —
  der Grund steht an der Zeile. Der gewählte Tab übersteht das Ein- und
  Ausklappen des linken Panels.
- **Wiki-Zitate sind im Chat verlinkt und öffnen das Zitat-Overlay.** Ein vom
  Zitierwerkzeug erzeugter Wiki-Beleg (`wiki:…`) stand bisher als toter Text im
  Gespräch — verlinkt wurde nur die Korpus-Form. Neu ist der Wiki-Token in jeder
  Form anklickbar, auch als Markdown-Link, und ein Klick öffnet dasselbe
  Zitat-Overlay wie bei Korpus-Belegen: Titel und Text des Atoms aus dem Wiki
  des aktiven Kurses, ohne die Korpus-Angaben (Version, Tags), die ein Atom
  nicht trägt. Nachgeprüft wird ein Wiki-Beleg beim Anzeigen bewusst nicht —
  das Material ist das eigene, und das Werkzeug hat den Beleg schon beim
  Erzeugen gegen das Wiki-Verzeichnis validiert. Ein Beleg auf ein unbekanntes
  Atom öffnet das Overlay im bestehenden „nicht gefunden"-Zustand, ohne
  Fehlermeldung und ohne Markierung am Token.

### Changed

- **Die Kurs-Detailansicht ist aufgeräumt.** Löschen sitzt neu als
  Papierkorb-Symbol in der Titelzeile neben dem Umbenennen-Stift — weiterhin in
  zwei Schritten mit unveränderter Rückfrage. Die beiden Ordner-Knöpfe („Reveal
  in folder", „Open wiki folder") sind entfernt: Die Detailansicht zeigt bewusst
  keine Dateisystem-Verweise mehr; gespeicherte Gespräche erreicht man über den
  Chats-Tab. Das Wiki liegt hinter dem Wiki-Tab, ohne die frühere
  Zwischenüberschrift.
- **Die Rückfrage von New Session ist kurz.** Statt der zweistufigen Erklärung
  mit Dateinamen steht dort: „Start a new session? Your CBE Process Canvas and
  CBE Maturity entries are preserved. You can resume this conversation anytime
  from Courses." Kein Dateiname, kein Pfad — das bisherige Gespräch ist über den
  Chats-Tab des Kurses auffindbar. Auch die Fehlermeldung eines gescheiterten
  Neustarts verweist auf Courses statt auf die Datei.

## [0.1.11] — 2026-08-19

### Changed

- **Die Rollen-Beschriftungen über den Chat-Blasen sind ausgeblendet.** Über jedem
  Turn stand bisher eine kleine Versal-Zeile — `LECTURER` über dem eigenen Text,
  `CBE SKILL` über der Antwort. Sie sagte nichts, was das Gespräch nicht schon
  selbst zeigt: Die eigene Eingabe steht rechts in einer gefüllten Blase, die
  Antwort links als blanker Fliesstext. Die Beschriftung bleibt im Dokument und
  wird weiterhin von Screenreadern vorgelesen — sie ist das einzige Element, das
  einen Turn benennt, und die verbleibenden Unterschiede (Ausrichtung, Füllung,
  Blasenform) erreichen Hilfstechnologie nicht.

### Added

- **Atome aus dem eigenen Wiki lassen sich zitieren.** Trug ein Atom des Kurs-Wikis
  dieselbe Quelle wie ein Korpus-Dokument, verweigerte das Zitierwerkzeug bisher den
  Korpus-Beleg und verwies auf das Wiki — nur erzeugen konnte es einen solchen Beleg
  nicht, so dass nur das Tippen von Hand blieb und der Verweis ins Leere führte. Das
  Werkzeug erzeugt den Wiki-Beleg jetzt selbst und prüft ihn gegen das Verzeichnis des
  Wikis; ein Abschnitt bleibt Pflicht, weil er sagt, woher im Atom die Aussage stammt.

### Fixed

- **Ein Wiki-Ingest bei nicht laufendem Modell-Server scheitert neu sichtbar,
  statt hängen zu bleiben.** Wer Material einlas, während der eigene
  Inferenz-Server nicht lief, bekam bisher gar nichts zu sehen: keine
  Fehlermeldung, kein Ende des Laufs — die ausgewählten Dokumente lagen bereits
  im Kurs, atomisiert wurde nie etwas, und danach liess sich überhaupt kein
  Ingest mehr starten, auch nicht, als die Verbindung wieder stand. Nur ein
  Neustart der Anwendung half. Neu wird gleich nach der Dateiauswahl geprüft, ob
  der eingetragene Endpunkt erreichbar ist, und der Ingest bricht mit benanntem
  Grund ab, bevor eine einzige Datei im Kurs abgelegt wird. Abgewiesen wird dabei
  nur, was nachweislich nicht da ist — Verbindung abgelehnt, Adresse nicht
  auflösbar oder nicht erreichbar. Ein Endpunkt, der bloss langsam antwortet,
  etwa ein lokales Modell beim Laden seiner Gewichte, wird nie abgewiesen, und
  auch ein Server, der zwar antwortet, aber den Schlüssel ablehnt oder die
  abgefragte Route nicht kennt, hält den Ingest nicht auf. Verstummt ein Modell
  mitten in der Atomisierung, gilt das betroffene Dokument nach zwei Minuten
  Stille als gescheitert und nennt den Grund; die übrigen Dokumente des Laufs
  laufen unverändert weiter, und das gescheiterte lässt sich unverändert erneut
  einlesen.
- **Ein festhängender Ingest lässt sich abbrechen, ohne die Anwendung neu zu
  starten.** Der Abbrechen-Knopf konnte einen Lauf bisher nur bitten
  aufzuhören — hing der Lauf, änderte er nichts, und der Eintrag blieb für immer
  „läuft". Neu endet der Abbruch den Lauf in der Ansicht in jedem Fall, der Knopf
  zum Einlesen steht sofort wieder bereit, und ein danach noch eintreffendes
  Ergebnis des alten Laufs kann einen inzwischen gestarteten neuen weder beenden
  noch dessen Zeilen überschreiben. Die Abschlussmeldung sagt dabei nur, was
  wirklich geschah: Erreichte der Abbruch keine laufende Atomisierung — etwa
  während der Verbindungsprüfung oder beim Einlesen nach `inbox/` und `raw/` —,
  steht das so da, statt den Ingest als abgebrochen auszuweisen.

## [0.1.10] — 2026-08-19

### Added

- **Die Assistenz liest neu das Wiki des Kurses.** Bisher hatte sie dafür keinen
  Weg: Sie wusste zwar, wo das Wiki liegt, aber nichts sagte ihr, dass es einen
  Index gibt und dass die Atome die Einheit sind — im Zweifel griff sie zum
  importierten Original unter `raw/`, also zu genau dem, was niemand kuratiert
  hat. Neu holt sie zuerst den Index mit allen Atomen dieses Kurses und fragt
  danach gezielt die Atome ab, die sie daraus ausgewählt hat; ein Atomtext wird
  nie vor dem Index ausgeliefert. Während sie liest, steht im Verlauf „Reading
  wiki". Hat der Kurs noch kein Wiki oder noch keine Atome, sagt sie das, statt
  das Wiki als abgedeckt darzustellen. Landen während eines laufenden Gesprächs
  neue Atome aus einem Ingest, erfährt sie das beim nächsten Zug und liest den
  Index erneut — man muss dafür kein neues Gespräch beginnen.
- **Die Assistenz belegt neu auch aus dem Wiki des Kurses.** Deckte ein Atom des
  Wikis dieselbe Quelle ab wie ein Korpus-Dokument, verweigerte sie bisher den
  Korpus-Beleg und verlangte einen Wiki-Beleg — den sie selbst gar nicht
  erzeugen konnte. Es blieb nur, ihn von Hand zu schreiben, und ein von Hand
  geschriebener Beleg ist kein Anker: Er sieht genau aus und führt ins Leere.
  Neu wird ein Wiki-Beleg gleich geprüft wie ein Korpus-Beleg — das Atom muss im
  Index des Kurses stehen, der genannte Abschnitt muss eine echte Überschrift des
  Atoms sein, und Autor und Jahr stammen aus den Quellenangaben des Atoms, nie
  aus dem Gedächtnis. Der Abschnitt bleibt dabei ebenso verbindlich wie beim
  Korpus: Er sagt, woher im Atom die Aussage kommt. Trägt ein Atom keine
  Autorenangabe — der Normalfall nach einem gewöhnlichen Ingest —, nennt der
  Beleg Atom und Abschnitt ohne Autor und Jahr, statt zu scheitern. Nennt die
  Assistenz ein Atom, das der Index nicht führt, erfährt sie, welche Atome es
  gibt, statt zu raten. Im Verlauf ist eine solche Belegkarte neu nach dem Wiki
  benannt und nicht mehr als Korpus ausgewiesen. Noch offen: Ein Wiki-Beleg
  steht im Text vorerst als reiner Text da; anklickbar wie ein Korpus-Beleg wird
  er in einem eigenen Schritt.

### Fixed

- **Erfahrene Dozierende bekommen keine fertigen Vorschläge mehr untergeschoben.**
  Wer viel Vorerfahrung mit PBL und CBE mitbrachte, dafür aber wenig Zeit, wurde
  ab der Big Idea trotzdem mit ausformulierten Vorschlägen für das eigene Modul
  bedient — "ja, gut, übernehmen" genügte, und der Schritt galt als erledigt. Die
  Ursache lag nicht an fehlender Strenge, sondern an einer falsch verdrahteten
  Einstellung: Die knappe Zeit zählte als Grund, mehr Unterstützung zu geben, und
  wo zwei Einschätzungen auseinanderliefen, hiess "vorsichtiger" eben "mehr
  vorgeben". Neu richtet sich das Mass an Unterstützung allein nach der
  Vorerfahrung; die verfügbare Zeit bringt weiterhin einen kürzeren Weg und eine
  benannte Priorisierung, aber weder eine verkürzte Wahrheit noch fertige
  Inhalte. Und wo zwei Einschätzungen auseinanderlaufen, gilt die vorsichtigere
  Lesart nur noch für den Befund, den Widerspruch und die Quelle — nie für die
  Menge an Unterstützung. Ein Beispiel ohne Nachfrage bleibt möglich, aber nur
  noch dort, wo der Schritt selbst erklärt wird, und es bleibt das Beispiel aus
  einem fremden Fach, das sich nicht übernehmen lässt. Am Festhalten einer
  Entscheidung ändert sich nichts: Sagt die Dozentin oder der Dozent zu, wird der
  Schritt wie bisher festgehalten.
- **Belege entstehen über das Zitierwerkzeug statt von Hand.** Die Anweisung an die
  Assistenz lautete bisher: Index lesen, Dokument lesen, den Beleg _schreiben_. Ein
  selbst getippter Beleg ist aber kein echter Anker — der Verweis führte ins Leere,
  und ein funktionierender kam erst, wenn man den toten Link reklamierte. Der Weg
  führt jetzt über `cbe_cite`, das den Beleg erzeugt und gegen das Korpusverzeichnis
  prüft; ein Abschnitt bleibt Pflicht, weil er sagt, woher im Dokument die Aussage
  stammt. Die Regel, die den handgeschriebenen Weg noch für zulässig erklärte, ist in
  allen betroffenen Spezifikationen zurückgezogen.
- **Das Vertiefungsangebot hängt nicht mehr an jedem Turn.** Der Assistent
  schloss zuletzt fast jede Antwort mit einem zusätzlichen Angebot ab, auch dort,
  wo nichts offen geblieben war — zuletzt gern als Verfahrensfrage, etwa welche
  Art von Ergebnis das Modul verlangen soll. Neu folgen die ein bis zwei
  konkreten Angebote nur dort, wo tatsächlich etwas zu vertiefen bleibt. Wo etwas
  offen ist, kommt das Angebot weiterhin, gleich konkret und weiterhin höchstens
  zwei. Am Rest der Antwortform ändert sich nichts: die knappe Kernantwort steht
  zuerst, es gibt keine Längenbegrenzung, und ein Widerspruch, eine nötige Quelle
  oder ein Einwand wird nie der Kürze wegen weggelassen.
- **Der Fortschritt eines laufenden Wiki-Ingests überlebt das Einklappen der
  linken Spalte.** Klappte man sie während eines Laufs ein, verschwanden bisher
  die Zeilen zu den einzelnen Dokumenten, der Abbrechen-Knopf und die
  Abschlussmeldung — der Ingest lief weiter, zu sehen war davon nichts mehr, und
  beim Ausklappen stand die Oberfläche leer da, als wäre nie etwas gestartet
  worden. Der Lauf wird nun ausserhalb der Ansicht geführt: Ein- und Ausklappen
  ändert nichts an ihm, beim Ausklappen stehen die Zeilen wieder vollständig da
  — auch die Meldungen, die eintrafen, während die Spalte eingeklappt war —, der
  Abbrechen-Knopf wird wieder angeboten, und die Abschlussmeldung erscheint auch
  dann, wenn der Lauf endet, während nichts davon zu sehen ist. Am eingeklappten
  Streifen zeigt die Markierung am Kurs-Symbol neu auch einen laufenden Ingest
  an und nennt, wie viele Dokumente des Laufs bereits erledigt sind.

## [0.1.9] — 2026-08-18

### Changed

- **Die Modell-Einstellungen zeigen zuerst nur, was für die Verbindung nötig
  ist.** Die Gruppe „Model" führt neu vier Dinge: Base URL, Model ID, API key und
  den Verbindungstest, mit „Save" daneben. Alles, was nicht dem Verbinden dient,
  liegt darunter hinter der aufklappbaren Zeile **„Advanced"**: Reasoning samt
  Reasoning effort (low/medium/high), Context length und das Löschen des
  hinterlegten Schlüssels. „Advanced" ist bei jedem Öffnen der Einstellungen
  wieder zugeklappt — ausser eine noch nicht gespeicherte Änderung liegt darin,
  dann steht sie offen vor einem. Am Verhalten ändert sich sonst nichts: gleiche
  Voreinstellungen, gleiche Prüfungen, gleiche Speicherung des Schlüssels.
- **Erklärungen stehen nicht mehr im Weg, sondern hinter einem „?".** Die
  bisherigen Hinweiszeilen unter den Feldbezeichnungen sind verschwunden; rechts
  neben jedem Feld sitzt ein „?", das auf Klick oder mit Enter/Leertaste den
  Erklärungstext einblendet — erneut betätigen oder Escape blendet ihn wieder
  aus, und beim nächsten Öffnen der Einstellungen ist er zu. Das gilt in beiden
  Ebenen der Modell-Gruppe gleich. Was auf der Oberfläche bleibt, weil es kein
  Hilfetext ist: ob ein Schlüssel hinterlegt ist, die Hinweise zur eingetippten
  Adresse, der Hinweis auf einen für den neuen Endpunkt nötigen Schlüssel,
  Speicher- und Testrückmeldungen sowie die Aussage, dass alles lokal bleibt.
- **Der API-Schlüssel ist beim Eintippen lesbar** statt mit Punkten verdeckt —
  gerade beim Einfügen eines Schlüssels ist es das, was man sehen will. Ein
  bereits hinterlegter Schlüssel wird dabei nie angezeigt: das Feld startet immer
  leer, und ob einer hinterlegt ist, sagt weiterhin die Zeile darüber.
- **Schritt 6 des CBE Process Canvas trägt vier Karten statt acht** — je eine
  pro Element der Lernreise: Engage Sequence, Investigate Sequence, Act
  Sequence, Reflect Sequence. Jede hält den Anteil ihres Elements am einen
  benannten Ergebnis des Schritts, dem Phasenplan bzw. der Modul-Zeitachse. Die
  sechs bisherigen Karten der Elemente Investigate und Act — Guiding Questions,
  Activities & Resources, Analysis, Solution Concepts, Solution Development,
  Implementation & Evaluation — sind entfallen: sie beschreiben, was
  Studierende in der Lernreise tun, und liessen den Entwurf eine Checkliste
  studentischer Arbeit ausfüllen, die der Entwurfsprozess nie verlangt hat. In
  einem bestehenden Kurs geht dabei nichts verloren — was dort eingetragen ist,
  bleibt gespeichert und weiterhin auf dem Canvas lesbar —, es zählt aber nicht
  mehr als benanntes Ergebnis des Schritts: der Fortschritt von Schritt 6 misst
  sich nun an den vier neuen Karten, die zunächst leer sind. Schritt 4 behält
  seine drei Karten (Big Idea, Essential Question, Challenge Statement)
  unverändert.
- **Ein Schritt gilt erst als entschieden, wenn die Dozentin es gesagt hat.** Bisher
  hielt der Skill auch das Annehmen eines Vorschlags, den der Assistent selbst
  formuliert hatte, für den Auslöser, einen Schritt abzuschliessen und auf seine
  Karte zu schreiben — und stand damit im Widerspruch zu seiner eigenen Regel,
  keine fertigen Artefakte für das Modul der Dozentin zu liefern. Der Auslöser ist
  jetzt allein die von ihr genannte Entscheidung. Dazu benennt der Skill erstmals,
  was eine leere Karte ist: eine Frage, die die Dozentin noch nicht beantwortet
  hat, und kein Mangel, den der Assistent behebt, indem er sie selbst ausfüllt.
- **Reifegrad-Ziel und Entwurfs-Durchgänge sind zwei unabhängige Dinge.** Bisher
  las der Skill die Zahl der Durchgänge aus dem angestrebten Reifegrad ab. Das
  hält der Sache nicht stand: ein niedriges Ziel verbietet keinen zweiten
  Durchgang, und drei sorgfältige Durchgänge sichern keine hohe Stufe zu — der
  Reifegrad bewertet das Ergebnis, die Durchgänge beschreiben das Vorgehen. Beim
  Abschluss ist ein weiterer Durchgang deshalb als Möglichkeit sichtbar, ohne
  angetragen zu werden; auf jedem Stand aufzuhören bleibt ausdrücklich in Ordnung.
  Und wird ein Schritt erneut bearbeitet oder vertieft, zieht seine Stufe im
  Zehn-Schritte-Diagramm mit, statt nur im Gespräch stattzufinden.

### Fixed

- **Ein Wikilink in `related:` kostet nicht mehr das ganze Atom.** Beim Ingest
  geschriebene Atome wurden verworfen, sobald `related:` einen Wikilink ohne
  Anführungszeichen trug — YAML liest `[[concept/x]]` dort nicht als Text,
  sondern als verschachtelte Liste, und die Prüfung wies das Atom ab. Die
  Anleitung der Atomisierung zeigt jetzt die Schreibweise, die trägt
  (`related: ["[[concept/x]]"]`), und die Prüfung gewinnt einen ohne
  Anführungszeichen geschriebenen Eintrag, der genau einen Wikilink enthält,
  wieder zurück, statt das Atom zu verlieren. Ein Eintrag, der sich nicht
  eindeutig zurückgewinnen lässt, zählt als keine Beziehung: er entfällt, das
  Atom bleibt, und der Verlust steht benannt im Reflexionslog des Laufs.
- **Ein gescheitertes Dokument reisst den Ingest-Lauf nicht mehr mit.** Bisher
  konnte ein Fehler ausserhalb der eigentlichen Arbeit an einem Dokument — etwa
  beim Aufräumen seiner Sitzung oder beim Melden des Fortschritts an ein bereits
  geschlossenes Fenster — den ganzen Lauf beenden: die Ergebnisse der übrigen
  Dokumente gingen verloren, wartende Dokumente wurden nie begonnen. Jeder Lauf
  liefert nun zu jedem Dokument genau ein Ergebnis. Und was eine Sitzung
  geschrieben hatte, bevor sie scheiterte, geht durch dieselbe Prüfung wie ein
  erfolgreicher Lauf: gültige Atome werden als gelandet gemeldet, ungültige
  entfernt — nichts bleibt ungeprüft und unerwähnt liegen. Am Urteil über das
  Dokument ändert das nichts: es gilt weiter als gescheitert und lässt sich
  unverändert erneut ingestieren.
- **Ein abgebrochener Ingest entfernt nur, was der Lauf selbst angelegt hat.**
  Das Aufräumen nach einem Abbruch löschte jede Datei, die die Sitzung
  angefasst hatte — also auch `wiki/index.md` und ein bereits vorhandenes Atom,
  in das sie hineingeschrieben hatte. Entfernt werden jetzt ausschliesslich die
  Atome, die dieser Lauf neu erzeugt hat; alles, was er vorgefunden hat, bleibt.
  Lässt sich nicht feststellen, was vorher da war, wird gar nichts entfernt. Und
  ein Abbruch, der eintrifft, bevor die Atomisierung eines Dokuments begonnen
  hat, verhindert deren Start, statt sie noch durchlaufen zu lassen.
- **Eine zitierte Quelle liest sich als Dokument, nicht mehr als ihr Quelltext.**
  Klickte man im Gespräch auf eine Zitat-Angabe, öffnete sich die Quelle bisher
  als roher Markdown-Text: der `---`-Block des Dateikopfs, `#`-Zeichen vor
  Überschriften, Sternchen um Hervorhebungen, Striche als Tabellen. Der Text
  wird jetzt gesetzt wie überall sonst in der Anwendung — Überschriften, Listen,
  Tabellen, Zitatblöcke, Formeln und Code —, und Zitat-Angaben innerhalb des
  Dokuments sind wieder anklickbar. Der `---`-Block erscheint nicht mehr, weil
  der Kopf des Fensters dessen Angaben ohnehin aufbereitet zeigt, und der Titel
  steht noch einmal statt zweimal da.

## [0.1.8] — 2026-08-18

### Added

- **Eine laufende Antwort lässt sich stoppen.** Solange die Assistenz
  arbeitet, wird aus dem runden Senden-Knopf ein Stopp-Quadrat; ein Klick
  darauf beendet den laufenden Zug. Bisher liess sich eine einmal
  abgeschickte Anfrage überhaupt nicht abbrechen. Was bereits geschrieben wurde, **bleibt
  stehen** — man hat es ja ankommen sehen — und trägt im Verlauf den Hinweis,
  dass die Antwort gestoppt und damit unvollständig ist; dieser Hinweis
  überlebt einen Neustart und das erneute Öffnen der Sitzung. Ein Stopp ist
  kein Fehler und kein Abschneiden: weder der Hinweis auf eine abgeschnittene
  Antwort noch Fortsetzen und Erneut werden dafür angeboten, und eine
  Fehlermeldung erscheint nicht. Angehängte Dateien kommen nicht in das
  Eingabefeld zurück — sie haben das Modell erreicht —, während sie bei einem
  fehlgeschlagenen Senden weiterhin zurückkommen. Bereits Erarbeitetes bleibt
  unangetastet: CBE Process Canvas, Entwurfsschritte und CBE Maturity behalten,
  was der gestoppte Zug bis dahin eingetragen hat. Solange der Stopp noch aussteht,
  zeigt der Knopf das an und nimmt keinen zweiten Klick entgegen. Während der
  Kontext zusammengefasst wird, ist der Stopp mit lesbarer Begründung
  abgelehnt; und in dem seltenen Fall, dass ein Stopp nicht zum Abschluss
  kommt, erklärt ein Hinweis die Lage und bietet an, das Gespräch zu schliessen
  und ein frisches zu beginnen. Ein Tastenkürzel gibt es dafür bewusst nicht —
  Escape behält seine bisherigen drei Bedeutungen.

## [0.1.7] — 2026-08-17

### Added

- Das Eingabefeld zeigt nun an, **wie voll der Kontext des Modells ist**: ein
  kleiner Ring links neben der Modellanzeige füllt sich im Lauf des Gesprächs.
  Er beantwortet die Frage, die man sonst erst merkt, wenn es zu spät ist —
  nämlich wann das Gespräch gleich zusammengefasst wird und ältere Stellen
  dabei an Genauigkeit verlieren. Der genaue Wert steht als Text im
  Mauszeiger-Hinweis und ist für Screenreader lesbar. Ist im Modell-Abschnitt
  der Einstellungen keine Kontextgrösse hinterlegt, bleibt der Ring
  zurückhaltend, statt einen Anteil von einer unbekannten Gesamtmenge zu
  behaupten.

### Changed

- **Das Eingabefeld ist neu gestaltet.** Es steht jetzt als eigene, abgerundete
  Karte da, mit allen Bedienelementen darin. Links öffnet ein rundes **+** ein
  kleines Menü mit genau zwei Einträgen — **Dateien hochladen** und **Hilfe**;
  beide taten schon vorher dasselbe, sie sind nur nicht mehr über die
  Oberfläche verstreut. Rechts stehen die Anzeige des eingestellten Modells,
  die zu den Einstellungen führt, und ein runder Senden-Knopf. Das Anhängen von
  Material, die entfernbaren Anhang-Chips und die Hilfe-Anfrage verhalten sich
  unverändert.
- **Enter sendet, Umschalt+Enter macht einen Zeilenumbruch.** Bisher war es
  umgekehrt. Cmd/Strg+Enter sendet weiterhin. Wer gerade einen
  Schrägstrich-Befehl vervollständigt oder Zeichen über eine Tastaturhilfe
  eingibt, dem sendet Enter nichts vorzeitig ab.
- **Auf breiten Bildschirmen läuft das Gespräch in einer zentrierten Spalte.**
  Vorher klebten die Antworten der Assistenz am linken und die eigenen Beiträge
  am rechten Fensterrand, was bei einem grossen Bildschirm auseinandergerissen
  wirkte. Transkript und Eingabefeld teilen sich nun eine Mittelachse und einen
  gemeinsamen Rand, der auch beim Scrollen nicht springt. Auf schmalen Fenstern
  ändert sich nichts.
- **Neue Sitzung** sitzt jetzt in der Kopfzeile des Gesprächs. Was der Knopf
  tut und was er dabei erhält, ist unverändert.

## [0.1.6] — 2026-08-17

### Added

- The Profile section of the profile-and-settings overlay now carries two
  entries of your own, above the assistant's estimates: your **name** and the
  **preferred form of address** you would like the assistant to use. Both are
  optional and independent of each other — fill in one, both, or neither — and
  they are your statement about yourself, not an estimate: no confidence, no
  evidence pointer, no provenance, and nothing the assistant can change. Type
  into a field and press Save; empty a field and press Save again to remove it.
  Values are kept and shown in your own words and language — nothing is
  reformatted, shortened or translated — up to 120 characters each; a longer
  entry is refused with a visible reason rather than silently cut. Leaving both
  empty keeps the previous behaviour unchanged — with nothing recorded the
  assistant asks for neither value.

### Changed

- The two panel controls now name the surface they belong to. The Export
  control's hover text and its nothing-to-export reason say **CBE Process
  Canvas**; the "Assess maturity" control's hover text and both of its disabled
  reasons — the assistant is still working, no conversation is open — say **CBE
  Maturity**. Naming only: what either control does is unchanged.

## [0.1.5] — 2026-08-15

Note for testers: every panel in the window has moved. Courses are in a new left
panel, settings and profile are in an overlay, the maturity target and achieved
reading sit in a header block, and the course switcher and provider readout have
left the header. Your courses and their recorded design open as before, but the
controls are not where you left them.

### Changed

- The window is laid out as two side panels around the chat. Courses moved out
  of the right panel into a **left panel** that carries both the course list and
  a course's detail view, the per-course wiki with it; it starts collapsed to a
  narrow strip with a Courses icon. The **right panel** now holds exactly the two surfaces that belong to the
  course — CBE Process Canvas and CBE Maturity — and starts expanded on the
  canvas, so the design work is on screen straight away. Both panels follow the
  same rules: resize by dragging the handle on their edge, collapse to a rail and
  back, keyboard-operable throughout. A panel's width is remembered across
  restarts; whether it is collapsed is not. In a window too narrow for both, the
  panels give way before the chat does — the left one collapses first, and
  reopening it is never refused. The window itself can no longer be sized below
  the width the chat plus one panel needs.
- The header no longer switches courses: the course-switcher dropdown is gone,
  and clicking the active course name reveals the course list in the left panel,
  where one click on a card switches course. The name still says which course you
  are in, in every view. The technical readout of provider host and model id has
  left the main view — that is configuration, and it lives in Settings, which is
  where you read which provider and model are actually in force. Top right, two
  icons remain: the settings gear and, to its right, the profile icon — each
  opens the same overlay, at Settings and at Profile respectively.
- Settings and Profile now live in one overlay drawn **over** the workspace, as
  two sibling sections you can switch between without closing it. The chat column
  and both panels keep their widths, scroll positions and a half-typed message
  underneath it. Close it with Escape, its × control, or a click outside — none of
  the three loses anything: an unsaved settings edit is still there when you come
  back, the gear carries a mark while one is pending, and re-opening lands on the
  group holding it. Settings itself is regrouped into four collapsible groups —
  Model, Appearance, About, Corpus — with one open at a time; every showing opens
  on Appearance, so reaching the model connection is one click on its header. The
  read-only section that listed the installed skill is now the About group.
- The data-handling note no longer sits permanently under the chat composer, nor
  beside pending attachments. Nothing about how your data is handled has changed:
  the same three facts — stored on your device only, read by the language model
  you configured, governed by that provider's data-protection terms — are stated
  in full in `docs/data-handling.md`, and on the UX-Tests page of the stakeholder
  portal. Which provider's terms apply right now is still read where it is
  configured: Settings → Model. The Settings Model group keeps its plain-language
  statement that credentials and submitted material stay local and go only to the
  endpoint you configured.
- The CBE Maturity panel opens with the two figures you read against each other:
  the target maturity settled for the design as a whole, and the overall level
  reached — one block above the seven criterion rows, no aggregate row at the
  bottom any more. The overall level is now worked out from the criterion
  readings themselves instead of being stated separately, so it can no longer
  disagree with the criterion rows beneath it: it is the mean of the assessed
  criteria (shown alongside the rounding), it names how many of the seven it
  rests on, and it never rises above a criterion held down by a finding you left
  standing — which is marked as its own thing, distinct from a reading marked
  uncertain for thin evidence. While no criterion is assessed there is no overall
  level at all: the panel says the reading is not yet due rather than showing a
  placeholder, and a recorded limitation is still shown beside that. A target on
  its own is not an empty panel — the ambition is shown, and where none has been
  settled the panel says so in the same words the assistant uses. Where nothing
  has been assessed yet, the panel says so for the **course**: the reading
  belongs to the course you are working in and stays with it when you start a new
  session, instead of reading as if every conversation began a reading of its
  own. The exported design document states the same reading, worked out the same
  way, so the file and the panel cannot say different things.
- The app calls the two design surfaces by their names everywhere it speaks to
  you, instead of the collective word "Artefacts". Before a card is cleared, the
  confirmation names that card and says its content is cleared from the CBE
  Process Canvas. The New Session confirmation lists what is kept in the same
  words as the panels: the module design on the CBE Process Canvas, the recorded
  decisions, the design-step progress and the CBE Maturity reading. In the
  exported design document, the maturity section is headed "CBE Maturity".
- The assistant should reach for pill options more readily. The instruction that
  governs them led with the ways to get a picker wrong, and questions with a
  small closed set of concrete answers were being asked in prose instead; it now
  leads with the shape that calls for pills — a decision about the design that is
  yours to make and that the conversation branches on. Every safeguard against
  placeholder or form-like pickers is unchanged. The effect has not been measured
  against a model, so how often pills actually appear is worth watching.

### Fixed

- When you ask the assistant what the arrow beside a step header does, it now
  describes the control you actually have: clicking it marks that step as the one
  in focus, the marker moves immediately, nothing is added to the conversation,
  the assistant is told which step you chose with your next message, and the
  control stays usable while the assistant is working. It had been describing the
  older control — one that steered the conversation and was locked during a
  run — which the app has not had since 0.1.4, where the behaviour changed
  without the help text or these notes following it.
- Settings → About now states what is actually installed. It reads the running
  app version — which the app named nowhere before — and the loaded skill's own
  version, each read from its source instead of a number written into the app;
  the two are labelled apart, so the skill's version can no longer be read as
  the app's. It had been reporting a skill version of `0.1.0` while the
  installed skill was at `0.3.0`. The "Citation track" row is gone: the dev/prod
  citation double-track it named was removed in 0.1.4. Where a value cannot be
  read, the row says so instead of showing a number.

## [0.1.4] — 2026-08-11

Note: `v0.1.3` was tagged and released without its own heading here, so the
entries below span everything since `0.1.2` — both what shipped in `0.1.3` and
what came after it.

### Added

- Course workspaces with one canonical conversation per course, background
  course sessions, and a course switcher in the header.
- Canvas with ten step groups, in-place profile writes, and artefact deletion
  control.
- Lecturer wiki ingestion (per-course knowledge store) with browse view.
- Operation modes internalized into the CBE skill (design / transfer / review
  without explicit mode switching).
- Linux AppImage build target with published SHA256 alongside macOS/Windows.
- Corpus distribution groundwork: versioned corpus bundle + in-app corpus
  version surface (see openspec change `ship-distribution-and-release`).
- Per-course design state persists: canvas artefacts, design-step coverage, the
  maturity reading and the decision artefacts come back when the course is
  reopened after an app restart, and a New Session in the same course keeps
  them. A course with no recorded state opens empty — nothing is inherited from
  another course and nothing is materialised that was never established.
- Courses can be deleted, from a course's detail view only — never from the
  course list, where the card surface is the one-click activation control. The
  control arms a confirmation instead of removing anything: it names what goes
  with the course (its sessions, canvas artefacts, wiki and ingested materials),
  cancelling is the default answer, and the course folder is moved to the system
  trash, so it can be restored from there. A deletion is refused while something
  is still running in that course (a turn, a wiki ingestion, a conversation
  still opening); an idle conversation is closed and written out first, so the
  copy in the trash is complete. If the move to the trash fails, the reason is
  shown, the course stays where it is and its conversation is reopened — a
  failed move is never downgraded to an irreversible delete. Every outcome,
  including a refusal, is announced for screen readers. Afterwards exactly one
  course stays active — a remaining one, or a fresh default course when the last
  one was deleted.
- The maturity reading is framed by the evidence it actually rests on: the panel
  names a thin evidence base with the concrete gap (material ingested, artefacts
  recorded, design steps touched) and what would make the reading fuller, marks a
  reading recorded on that basis as provisional, and marks one the design has
  moved past as out of date — levels stay visible in every case. The Assess
  control stays available in every state and is the named refresh path; the
  assistant re-assesses the affected criteria when the design moves on.
- The interface follows the agent's artefact work: an artefact change while the
  canvas is hidden reveals the Artifacts panel once per app session, later
  changes mark the Artifacts tab (on the tab and on the collapsed rail icon)
  until the canvas has been seen, and the canvas opens the step group that is in
  focus. A panel navigation by the lecturer outranks the automatic reveal for the
  rest of the app session.
- Mathematical notation is typeset instead of being shown raw. A model writing
  `$\rightarrow$` or a rubric weighting now renders as mathematics, inline and
  as a display block, in the chat and on the canvas cards alike. KaTeX ships
  with the app, so it works offline; a malformed expression degrades to its
  source rather than blanking the message, and a sentence with two currency
  amounts stays a sentence.
- The close at the end of the ten-step flow additionally carries the maturity
  reading against the declared target and a full inventory of what is still
  open — empty cards and findings left standing. A close in the middle of the
  flow is unchanged.

### Changed

- A turn never consists of tool cards alone. Where the substance of a turn is
  the recorded work, it now also carries one or two sentences saying what was
  recorded and why, in the lecturer's own terms.
- Canvas cards are written as structured Markdown rather than running prose: a
  lead line, a list where the content is an enumeration, a table where it is a
  mapping. Form stays subordinate to substance — a one-line decision stays one
  line, and nothing is invented to fill a row.
- What settles in a design step lands on that step's canvas card, and the step's
  progress and focus move with it. The reasoning stays in the conversation; the
  result is on the card instead of being written out a second time in the chat.
- The step in focus follows the work even when the design jumps ahead: pushing
  coverage for a step also puts that step in focus, and a coverage claim the app
  refuses (a step whose named output is not on the canvas yet) no longer takes
  the focus move down with it — the marker lands on the step being worked on.
  A bulk coverage claim the app refuses as implausible (a step jumped several
  levels at once) does not move the marker by itself, so bookkeeping about steps
  the assistant is not working on cannot pull it away from the current one —
  only a focus the assistant states outright still moves it.
- Corpus reground on the CBL Guide 2016 citations; corpus versioning switched
  to date-based versions (dev/prod double-track removed).
- Settings UX reworked (credentials, connection test, endpoint hints).
- Export sits in the artefacts panel's top control row, next to the iterate
  control and the annotation count, instead of in a row of its own below the
  annotation area.
- Text in the app's operating surfaces (settings, panel tabs, buttons, lists,
  headers, status lines) can no longer be selected by dragging. Everything the
  lecturer reads or types stays selectable and copyable: chat, artefact and
  canvas content, citations, error messages and all input fields.
- Asking for help now gets an answer that knows this app. The orientation names
  the actual controls — the right panel and why the canvas is hidden behind it
  when it starts collapsed, the design-flow canvas with its artefact notes,
  iterate and delete controls, the maturity panel, courses and the course
  switcher, the attachment button, profile and settings — restricted to the ones
  the running session actually offers. A control the app does not document is
  named as undocumented instead of being described from guesswork.
- The Markdown session archive shows the conversation as the lecturer saw it:
  their own text plus the names of any attached files, instead of the raw model
  payload with its ingest envelopes and injected notices. The JSON sidecar
  beside it still carries every turn verbatim, so the full record for audit and
  for reopening a conversation is unchanged.

### Fixed

- Reading course material no longer fails over cosmetic source metadata: a
  knowledge atom whose publication year is written as text (`"2023"`) is
  accepted, and an unusable source link costs only that link instead of the
  whole atom. Anything that is not a clean year or a full URL counts as "not
  stated" — citations then render `n.d.` or without a link — and the dropped
  value is written into the run's reflection log rather than swallowed.
- The picker shows exactly one free-text option, labelled in the lecturer's
  language — previously two adjacent ones appeared, one of them always English.
- A question the assistant puts through a picker or a decision checklist is no
  longer announced: the card carries the question, so the paragraph introducing
  it, telling the lecturer to choose and previewing what happens next is gone.
  Whatever the question rests on is said before the card, and the turn ends on
  the card itself — no further silent pass in which the assistant only states
  that it is waiting. A turn that consists of nothing but the card is a
  finished turn: it stays in the transcript and the message field unlocks.
  The recorded answer carries what the card asked — the picker's question, the
  checklist's title — so a conversation reopened after an app restart no longer
  shows, and no longer hands the assistant, an answer without its question.

## [0.1.2] — 2026-06-12

### Added

- Stories portal with build channel: testers download the current build behind
  Basic Auth (`plan/` portal, Cloudflare Pages worker proxying GitHub
  pre-releases).

### Fixed

- Profile override of a confirmed revision.

## [0.1.1] — 2026-06-10

### Fixed

- CI: build macOS unsigned — removed empty `CSC_LINK` (electron-builder treats
  an empty value as a certificate file path and fails).

## [0.1.0] — 2026-06-09

### Added

- First closed-testing pre-release: Electron shell (chat, canvas, citations,
  settings) around the `pi-coding-agent` runtime with the embedded CBE skill
  and the dev corpus; unsigned macOS (dmg+zip) and Windows (nsis) installers
  with SHA256SUMS via GitHub Actions.

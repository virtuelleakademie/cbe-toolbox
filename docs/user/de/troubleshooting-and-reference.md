---
pageId: troubleshooting-and-reference
locale: de
appVersion: 0.1.21
---

# Fehlerbehebung und Referenz

Wählen Sie anhand des sichtbaren Problems den nächsten sicheren Schritt.

<a id="troubleshooting"></a>

<!-- topic:troubleshooting -->

## Häufige Symptome und sichere Wiederherstellung

<a id="model-connection-fails"></a>

### Das Modell ist nicht konfiguriert oder der Verbindungstest scheitert

Ihre lokalen Course-Dateien bleiben sicher. Gehen Sie so vor:

1. Prüfen Sie die Modellkonfiguration wie unter [Modell verbinden](installation-and-local-it.md#model-connection) beschrieben: die exakte Basis-URL, Modell-ID und den API-Schlüssel ohne versehentliche äussere Anführungszeichen sowie Kontextfenster- und Reasoning-Werte, die Ihr Provider unterstützt.
2. Speichern Sie die Verbindung, bevor Sie den Verbindungstest in derselben Gruppe verwenden; der Test prüft die gespeicherte Verbindung. Er liefert eines dieser Ergebnisse:
   - „Endpunkt nicht erreichbar — prüfen Sie die Basis-URL und Ihr Netzwerk.“ Die App erreicht die Basis-URL nicht. Die Basis-URL kann falsch sein, oder etwas anderes blockiert die Verbindung, zum Beispiel ein VPN, das für diese Adresse nötig ist. Blockiert Ihre Institution den Endpunkt, wenden Sie sich an die lokale IT.
   - „Nicht autorisiert — der Endpunkt hat den API-Schlüssel abgelehnt (HTTP 401). Prüfen Sie ihn oder geben Sie ihn erneut ein.“ Die Basis-URL ist korrekt und erreichbar. Wahrscheinliche Ursache ist der API-Schlüssel oder seine Berechtigungen beim Provider. Manche Provider melden stattdessen HTTP 403.
   - „Verbindung in Ordnung — der Endpunkt hat geantwortet und den Schlüssel akzeptiert.“ Basis-URL und API-Schlüssel funktionieren. Kehren Sie zum Chat zurück und führen Sie ein Gespräch mit der Toolbox.

   Aus Sicherheitsgründen wird ein gespeicherter API-Schlüssel nie auf eine geänderte Basis-URL übertragen. Geben Sie den API-Schlüssel nach jeder Änderung der Basis-URL erneut ein, bevor Sie speichern.

3. Meldet der Test „Verbindung in Ordnung“, zeigt der Chat aber „Der Modellanbieter konnte die Anfrage nicht ausführen. Ihr Gespräch bleibt unverändert — versuchen Sie es erneut; die vollständigen Fehlerdetails stehen im Sitzungsprotokoll.“, ist wahrscheinlich die Modell-ID die Ursache. Modell-IDs legt Ihr Provider fest; es gibt keinen gemeinsamen Standard. Klären Sie die korrekte Modell-ID mit Ihrem Provider.

Kopieren Sie den Schlüssel nie in ein Ticket.

<!-- ui:settings-panel -->

### Der Provider meldet Rate Limit oder Modellfehler

Lassen Sie den Chat offen. Warten Sie die vom Provider genannte Frist ab oder wählen Sie einen freigegebenen Endpunkt/ein freigegebenes Modell. Wiederholen Sie die Anfrage einmal. Viele Wiederholungen können ein Rate Limit verschärfen. Gibt der Provider eine Request-ID aus, teilen Sie diese – nicht Prompt oder Schlüssel – mit der autorisierten Provider-Administration.

<a id="session-log"></a>

### Sitzungsprotokoll

Manche Fehlermeldungen verweisen für die vollständigen Fehlerdetails auf das Sitzungsprotokoll. Gemeint ist die gespeicherte Aufzeichnung des Gesprächs: Jedes Gespräch wird als `.jsonl`-Datei im Ordner `sessions` seines Course gespeichert; die zuletzt geänderte Datei gehört zum neuesten Gespräch. Die Course-Ordner liegen im App-Datenordner:

- macOS: `~/Library/Application Support/CBE Toolbox/courses/<Course-Ordner>/sessions/`
- Windows: `%APPDATA%\CBE Toolbox\courses\<Course-Ordner>\sessions\`
- Linux: `~/.config/CBE Toolbox/courses/<Course-Ordner>/sessions/`

Die Datei enthält das ganze Gespräch. Senden Sie sie nicht standardmässig weiter; siehe [Was Sie dem Support mitteilen](#support-sharing).

### Eine Antwort wirkt blockiert, wurde gestoppt oder abgeschnitten

Solange der Arbeitsstatus sichtbar ist, warten Sie oder verwenden das quadratische Stop-Steuerelement. Bereits empfangener Text bleibt erhalten. Bei ausdrücklich abgeschnittener Antwort wählen Sie Fortsetzen oder Wiederholen. Starten Sie nicht viele parallele Anfragen. Bleibt die App unansprechbar, warten Sie kurz auf die lokale Speicherung, schliessen Sie sie, öffnen Sie den Course erneut und prüfen Sie den letzten abgeschlossenen Turn.

<!-- ui:send-stop -->

### Course oder gespeicherter Chat lässt sich nicht öffnen

Kehren Sie zur Kursliste zurück und wählen Sie den Course erneut. Ein fehlendes oder beschädigtes verlustfreies JSON-Sidecar kann Resume deaktivieren, während das lesbare Markdown-Archiv gelistet bleibt. Bewahren Sie den Course-Ordner und kontaktieren Sie Support, bevor Sie etwas löschen. War eine Course-Löschung beabsichtigt, stellen Sie dessen ganzen Ordner über den Papierkorb des Betriebssystems wieder her.

### Ein Anhang lässt sich nicht extrahieren

<!-- formats:SUPPORTED_EXTENSIONS -->

Entfernen Sie den ausstehenden Anhang, bewahren Sie das Original und prüfen Sie, ob seine Endung zu **PDF, DOCX, PPTX, XLSX, TXT, MD, CSV** gehört und die Datei normal geöffnet werden kann. Reine Bildseiten oder geschützte/beschädigte Office-Dateien liefern möglicherweise keinen brauchbaren Text. Erstellen Sie eine zugängliche textbasierte Kopie, statt das Original zu überschreiben.

<!-- ui:material-upload -->

### Excel-Material wird abgelehnt

`.xls`, `.xlsb` und `.xlsm` werden bewusst abgelehnt. Öffnen Sie das Original in einer vertrauenswürdigen Tabellenkalkulation, erstellen Sie mit **Speichern unter** eine separate `.xlsx`-Kopie, prüfen Sie diese und hängen/importieren Sie sie erneut. Benennen Sie nicht nur die Dateiendung um.

### Ein Wiki-Import wird abgelehnt, scheitert oder wurde abgebrochen

Ein neuer Import kann nur für den aktiven Course und ohne bereits laufenden Import dieses Course starten. Aktivieren Sie den vorgesehenen Course und versuchen Sie das fehlgeschlagene Dokument erneut. Der Fehler eines Dokuments löscht erfolgreiche Geschwister nicht. Ein Lauf ohne Modellzugang endet sichtbar und bleibt wiederholbar. Haben Sie den Course gewechselt, öffnen Sie den Start-Course erneut, um seinen Lauf zu sehen oder abzubrechen.

### CBE Maturity zeigt provisorisch oder veraltet

Das beschreibt den Zustand und keinen Datenverlust. Provisorisch bedeutet dünne Evidenz; veraltet bedeutet, dass der aufgezeichnete Entwurf nach der Einschätzung geändert wurde. Bitten Sie im Gespräch um Besprechung oder Aktualisierung der Einschätzung. Kriterien-Stufen sind nicht manuell editierbar.

### Ein Zitat lässt sich nicht öffnen oder verifizieren

Bewahren Sie die Antwort, behandeln Sie die Aussage aber als unbestätigt. Öffnen Sie das Zitat erneut und prüfen Sie die Details. Fehlt ein Abschnitt, bitten Sie um die genaue Quellpassage oder eine benannte Lücke. Prüfen Sie bei Wiki-Material, ob das Atom im aktiven Course noch existiert. Ein plausibel wirkender defekter Link ist keine Evidenz.

### Ein Picker erscheint nicht oder meldet einen Fehler

Fahren Sie in Prosa fort: Wiederholen Sie die Frage kurz und nennen Sie Ihre Wahl. Der Assistent soll mit einer gewöhnlichen Frage weiterfahren und keine technischen Details zeigen. Frühere Course-Arbeit bleibt unberührt.

<a id="updates-and-refresh"></a>

<!-- topic:updates-and-refresh -->

### App-Update oder Inhaltsaktualisierung scheitert

Behalten Sie die installierte Version. Wiederholen Sie erst, nachdem lokale IT Netzwerkzugang und aktuelle Release-/Inhaltsquelle bestätigt hat. Deaktivieren Sie keine Zertifikatsprüfungen und ersetzen Sie keine Dateien im App-Paket. Beziehen Sie bei unsignierten macOS-Builds den nächsten Installer manuell; Inhaltsaktualisierung ist kein App-Update.

<a id="support-sharing"></a>

<!-- topic:support-sharing -->

## Was Sie dem Support mitteilen

Beginnen Sie mit App-/Skill-Version, Betriebssystem/-version, Zeitpunkt, sichtbarem Symptom, auslösenden Schritten und einem bereinigten Screenshot oder sichtbaren Fehlertext. Version 0.1.21 hat keinen Ein-Klick-Supportexport. Teilen Sie weder Provider-Schlüssel noch persönliche Studierendendaten. Senden Sie nicht standardmässig den ganzen App-Daten-/Course-Ordner. Benötigt autorisierter Support eine bestimmte Session-Markdown-Datei, ein JSON-Sidecar oder eine Diagnosedatei, vereinbaren Sie Datei und sicheren Kanal, behalten eine unveränderte Sicherung und entfernen vertrauliche Inhalte.

Kontaktieren Sie lokale IT bei Richtlinien, Zertifikaten, Proxy, Endpunkt-Erreichbarkeit, Installer-Vertrauen oder Speicherrechten. Dazu gehören auch Installationsprobleme wegen Einschränkungen auf institutionell verwalteten Geräten und Probleme mit der Modellkonfiguration (Basis-URL, Modell-ID, API-Schlüssel): Dafür ist Ihre lokale IT-Abteilung zuständig, nicht die Anbieter der CBE Toolbox.

Melden Sie einen reproduzierbaren Fehler der Anwendung selbst als Issue im GitHub-Repository [https://github.com/virtuelleakademie/cbe-toolbox/issues](https://github.com/virtuelleakademie/cbe-toolbox/issues). Nennen Sie die exakte App-Version und die Schritte, die zum Fehler führen. Nehmen Sie keine Schlüssel, persönlichen Daten oder Kursinhalte in ein Issue auf.

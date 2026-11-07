---
pageId: privacy-data-storage
locale: de
appVersion: 0.1.23
---

# Datenschutz, Daten und Ablage

So speichert die CBE Toolbox Daten und sendet Anfragen an den konfigurierten Modell-Provider.

> [!CAUTION]
>
> - Gespräche, einschliesslich Informationen, die in früheren Gesprächen über Sie gesammelt wurden (zum Beispiel Lehrerfahrung oder institutioneller Kontext), werden an den von Ihnen konfigurierten Inferenzdienst übermittelt. Es gelten die Datenschutz- und Datenrichtlinien dieses Dienstes. Die Nutzenden sind für die Einhaltung verantwortlich.
> - Bei jedem Start prüft die Anwendung unter einer bei Cloudflare gehosteten Adresse, ob eine neuere App-Version verfügbar ist. Dabei wird Ihre IP-Adresse gegenüber Cloudflare offengelegt. In Version 0.1.23 werden Corpus- und Skill-Inhalte nicht über das Netzwerk aktualisiert.

<a id="local-storage"></a>

<!-- topic:local-storage -->

## Was lokal gespeichert wird

Die Toolbox schreibt ihren Zustand in den App-Datenordner des Betriebssystems:

- macOS: `~/Library/Application Support/CBE Toolbox/`
- Windows: `%APPDATA%\CBE Toolbox\`
- Linux: `~/.config/CBE Toolbox/`

Darin besitzt jeder Course einen eigenen Ordner mit Kurskontext, Course-eigenen Sessions, Canvas-/Entwurfszustand, Wiki-Originalen/-Extraktionen/-Atomen und zugehörigem Material. Beim Löschen eines Course wandert dieser Ordner als Einheit in den Papierkorb des Betriebssystems.

Einige Einträge liegen absichtlich **ausserhalb aller Courses**: App-/Modelleinstellungen, dozierendenweite Profile-Schätzungen, Identität, dauerhafte Unterstützungspräferenz, Oberflächen-/Onboarding-Wahl und Arbeitsbereichszeiger. Der Provider-Schlüssel liegt bei der App-Konfiguration und wird, wo verfügbar, mit der Credential-Verschlüsselung des Betriebssystems geschützt. Er liegt nicht in einem Course.

<a id="backup-boundary"></a>

<!-- topic:backup-boundary -->

## Einen Course oder die ganze Installation sichern

1. Beenden Sie laufende Antworten und Wiki-Importe und **schliessen Sie die App**.
2. Bewahren Sie den Originalordner; kopieren statt verschieben.
3. Für einen Course kopieren Sie dessen vollständigen Ordner einschliesslich aller Session- und Wiki-Sidecars. Das erhält Course-eigene Arbeit, aber **nicht** dozierendenweites Profile/Support/Identität oder App-/Modellkonfiguration.
4. Für eine vollständige Sicherung kopieren Sie den ganzen CBE-Toolbox-App-Datenordner an ein institutionell freigegebenes, verschlüsseltes Ziel.
5. Stellen Sie nur in einer kompatiblen geprüften Installation wieder her und behalten Sie die Sicherung unverändert, bis der wiederhergestellte Zustand geprüft ist.

Ein vom Betriebssystem verschlüsselter Provider-Schlüssel lässt sich möglicherweise auf einem anderen Gerät oder Konto nicht entschlüsseln. Das Kopieren eines Course oder selbst des App-Datenordners garantiert keinen portablen brauchbaren Schlüssel; geben Sie ihn bei Berechtigung über die Einstellungsfläche neu ein.

<a id="provider-data-flow"></a>

<!-- topic:provider-data-flow -->

## Lokale Speicherung und Übermittlung an den Provider

Course-Arbeit wird auf Ihrem Gerät gespeichert. Beim Senden erhält das konfigurierte Modell, was es für die Antwort braucht: Ihre Nachrichten, relevantes Anhangs- oder Wiki-Material und abgerufene Corpus-Passagen. Die App sendet dies an den Endpunkt in der Modellgruppe des Einstellungs-Overlays und nicht an einen vom CBE-Toolbox-Projekt betriebenen Inferenzdienst.

<!-- ui:settings-panel -->

Ist dieser Endpunkt ein externer Dienst, verlässt das Material Ihr Gerät; dessen Regeln zu Aufbewahrung, Training, Region und Datenschutz gelten. Lesen Sie diese Bedingungen. Läuft der Endpunkt über Loopback auf Ihrem Gerät (zum Beispiel als lokal verwalteter kompatibler Server), bleibt der Modellaustausch lokal. Inhalts-/Versionsprüfungen sind getrennte Netzwerkvorgänge und ändern nicht, welches Modell eine Chat-Anfrage erhält.

<a id="student-data"></a>

<!-- topic:student-data -->

## Keine persönlichen Studierendendaten übermitteln

Persönliche Studierendendaten werden weder im Chat noch als Anhang oder Wiki-Import akzeptiert. Entfernen oder anonymisieren Sie Namen, Kennungen, Kontaktdaten, Noten, Freitext-Feedback und jede identifizierbare Kombination **bevor** Sie Material hinzufügen. Ein Provider-Vertrag macht identifizierbare Studierendendaten nicht zu zulässigem Input. Wenn Anonymisierung den wesentlichen Sinn entfernen würde, übermitteln Sie das Material nicht und wenden Sie sich an die Datenschutzstelle Ihrer Institution.

---
pageId: accessibility-keyboard
locale: de
appVersion: 0.1.23
---

# Barrierefreiheit und Tastatur

Tastatur-, Fokus-, Status- und Zoomverhalten der CBE Toolbox.

<a id="keyboard"></a>

<!-- topic:keyboard -->

## Bedienung mit der Tastatur

- Im Eingabefeld sendet **Enter**, **Shift+Enter** fügt eine neue Zeile ein. Cmd+Enter und Ctrl+Enter senden ebenfalls. Eingabemethoden werden berücksichtigt; das Bestätigen zusammengesetzten Texts sendet nicht versehentlich.
- Mit **Tab/Shift+Tab** bewegen Sie sich durch gewöhnliche Steuerelemente. Aktivieren erfolgt je nach Element mit Enter oder Leertaste.
- Das `+`-Menü am Eingabefeld, die Sprachauswahl im Kopfbereich, Panel-Offenlegungen, Settings-/Profile-Overlay und Picker sind per Tastatur bedienbar.
- Das native Anwendungsmenü folgt den Plattformkonventionen: Einstellungen verwenden auf macOS `Cmd+,` und unter Windows/Linux `Ctrl+,`, Hilfe verwendet `F1`; Bearbeiten/Ansicht/Fenster stellen native Bearbeitungs-, Zoom-, Vollbild- und Fensteraktionen bereit.
- **Escape** schliesst das aktuell offene Menü, die Sprachliste, Offenlegung, Panel-Ebene oder das Overlay, wenn diese Fläche Escape besitzt, und gibt den Fokus gegebenenfalls an den Auslöser zurück. Die Sprachliste unterstützt zusätzlich Pfeile, Home/End und Texteingabe zur Suche.
- Im Picker bewegt Tab/Shift+Tab zwischen Antworten, Leertaste oder Enter wählt, Escape verlässt die fokussierte Antwort. Die Freitextantwort nimmt Text und das Senden mit Enter an.
- **Escape stoppt keine Antwort.** Fokussieren und aktivieren Sie das quadratische Stop-Steuerelement. So zerstört ein globales Escape keine Arbeit, während Sie eine andere Fläche schliessen.
<!-- ui:send-stop -->

Die App nennt keine globale Shortcut-Palette. Funktioniert ein Weg nicht, verwenden Sie das fokussierte sichtbare Steuerelement und melden den sichtbaren Fehler, statt eine nicht dokumentierte Taste zu erraten.

<a id="focus-and-status"></a>

<!-- topic:focus-and-status -->

## Fokus, Benennungen und Status ohne reine Farbe

Tastaturfokus ist sichtbar umrandet. Das Schliessen von Popup oder Overlay gibt den Fokus lokal passend zurück; beim Course-Wechsel gelangt er in den zugehörigen Arbeitsbereich und bleibt nicht auf einer versteckten Schaltfläche. Die Einführungs-Karte stiehlt keinen Fokus.

Der offizielle PIONEER-Alliance-Link in der Informationsgruppe ist per Tastatur fokussierbar; seine Beschreibung sagt, dass er den Systembrowser öffnet. Scheitert dies, bleiben Fokus und App für einen neuen Versuch erhalten.

Wichtige Symbolsteuerelemente haben zugängliche Namen. Laufende Arbeit wird als Textstatus ausgegeben, und das Eingabefeld wechselt zu einem separat benannten Stop-Steuerelement; Farbe ist nicht das einzige Signal. Unsicherheit/Veraltung der Maturity-Lesart, aktiver Course, gewählte Sprache, Picker-Antworten und offene Offenlegungen tragen zusätzlich Text, Zustand oder zugängliche Semantik. Chat-Rollen bleiben für Assistenztechnologie verfügbar, auch wenn die sichtbare Rollenbezeichnung ausgeblendet ist.

<a id="zoom-and-native"></a>

<!-- topic:zoom-and-native -->

## Textgrösse, schmale Breite, Zoom und native Dialoge

Die Darstellungseinstellungen bieten eine Chat-Textgrösse. Das App-eigene Layout bleibt für die unterstützte schmale Breite von **775 CSS-Pixeln** und bei **200% browseräquivalentem Zoom** nutzbar, einschliesslich Einführung, Transkript und Eingabefeld. Seitenpanels lassen sich einklappen, damit das Gespräch Platz behält.

Dateiauswahl, Installerfenster und Sicherheitsmeldungen folgen der Tastatur- und Screenreader-Bedienung Ihres Betriebssystems. Verwenden Sie die Accessibility-Hilfe des Betriebssystems.

Falls der Fokus hängen bleibt oder Inhalte bei Ihrer Text-/Zoom-Einstellung überlappen, bewahren Sie den Course, notieren OS/Version, Fenstergrösse, Texteinstellung und fokussiertes Element und folgen der [Was Sie dem Support mitteilen](troubleshooting-and-reference.md#support-sharing).

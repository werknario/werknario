# Fleetlicht KI (werknario)

Web-nativer KI-Agent für die GitLab Web IDE. Er liest das Dokumentsubstrat des
Projekts, schlägt Änderungen als Diff vor und öffnet nach deiner Freigabe einen
Merge Request. Kein Terminal, keine lokale Installation.

## Einrichtung

Nach der Installation in den Web-IDE-Einstellungen setzen:

- `werknario.proxyUrl` — URL des EU-LLM-Proxys.
- `werknario.proxyToken` — Bearer-Token für den Proxy (kein GitLab- oder AWS-Schlüssel).
- `werknario.gitlabBaseUrl` — Basis-URL der GitLab-Instanz.
- `werknario.projectId` — Projekt-ID oder -Pfad.

Der GitLab-Token kommt automatisch aus der Web-IDE-Sitzung. `werknario.gitlabPat`
ist nur ein Fallback, falls keine Sitzung verfügbar ist.

## Nutzung

Befehl „Fleetlicht KI: Chat öffnen" ausführen, Aufgabe eingeben, Vorschlag
prüfen, Merge Request freigeben.

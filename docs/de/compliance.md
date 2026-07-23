# werknario für regulierte Organisationen

werknario ist ein Agent, der Büroarbeit so erledigt wie eine sorgfältige Kollegin: Er liest die vorhandenen Dokumente, schreibt einen Änderungsvorschlag und legt ihn einem Menschen zur Freigabe vor, bevor etwas endgültig wird. Ein Agent ist hier eine Software, die eine Aufgabe selbständig zu Ende führt und nicht nur antwortet. Jede Änderung ist ein lesbarer Diff, der von einem benannten Agenten vorgeschlagen und von einem benannten Menschen genehmigt wird, und die Dateien liegen in Git (GitLab oder GitHub).

Diese Seite richtet sich an Kanzleien, Kliniken und Verwaltungen, die vor einem Einsatz wissen wollen, wo die Daten liegen und was der Nachweis wirklich wert ist. Sie ist eine Einordnung, keine Rechtsberatung. Die weiterführende, verlinkte Dokumentation liegt derzeit auf Englisch vor.

## Berufsgeheimnis und Datenschutz

Wer unter das Berufsgeheimnis nach § 203 StGB fällt oder Mandanten- und Patientendaten nach DSGVO verarbeitet, muss wissen, ob diese Daten das Haus oder die EU verlassen. werknario kennt zwei Betriebsarten, die das verhindern.

Vollständig selbst gehostet mit offenen Gewichten. Sie betreiben ein Modell mit offenen Gewichten auf eigener Hardware, über einen vLLM- oder SGLang-Server. Die Anfrage verlässt Ihr Netz nicht. In der Modell-Registry sind solche Routen als `self-host` markiert. Auch der Rest der Umgebung, also der Git-Host und die Dokumentablage, kann auf Ihrer eigenen Infrastruktur laufen.

EU-Inferenz. Statt selbst zu hosten, nutzen Sie ein Modell, dessen Anbieter EU-Datenresidenz zusichert: Anthropic über das EU-Inferenzprofil von AWS Bedrock, oder Mistral über La Plateforme in Paris. In der Registry sind diese Routen als `eu` markiert.

Die EU-Residenz ist inzwischen technisch erzwungen, nicht nur behauptet. Beim Start der CLI, vor jedem Modellaufruf, prüft `checkRunResidency`, wohin die Route führt. Der Mock-Anbieter läuft lokal und ist ausgenommen. Bedrock gilt nur als EU, wenn `AWS_REGION` mit `eu-` beginnt (etwa `eu-central-1`); jede andere Region wird als nicht-EU behandelt. Die direkte Anthropic-API ist US-basiert und gilt als nicht-EU, auch bei einem Claude-Modell. Bei OpenAI-kompatiblen Endpunkten entscheidet der Eintrag in der Registry, und eine unbekannte Modell-ID gilt vorsorglich als nicht-EU. Eine nicht-EU-Route wird mit einer klaren Meldung blockiert, bevor irgendein Modell angesprochen wird. Wer sie trotzdem nutzen will, setzt `WERKNARIO_ALLOW_NON_EU=1`; die CLI gibt dann eine Warnung aus und fährt fort. Das ist nur für Daten ohne Personenbezug gedacht.

Wenn Sie ein Cloud-Modell einsetzen, reicht die technische EU-Residenz allein nicht. Der Anbieter muss auch vertraglich liefern: einen Auftragsverarbeitungsvertrag nach Art. 28 DSGVO, Standardvertragsklauseln für jede Übermittlung außerhalb der EU und die Zusage, dass Ihre Daten nicht zum Training verwendet werden. Ohne diese Grundlage ist eine Cloud-Route für Mandanten- oder Patientendaten nicht tragfähig, unabhängig von der Region.

## Was das Audit-Log belegt und was nicht

Jede Aktion wird in einer Hash-Kette festgehalten. Jeder Eintrag trägt den Fingerabdruck des vorherigen, sodass sich die Reihenfolge nachträglich nicht unbemerkt verändern lässt. Wird ein Eintrag in der Mitte der Kette geändert, gelöscht, umsortiert oder eingefügt, bricht die Prüfung sichtbar ab. Zusätzlich wird der aktuelle Ketten-Kopf beim Öffnen eines Merge Requests in dessen Beschreibung gestempelt. Der Git-Server hält damit einen unabhängigen Anker, den die lokale Datei nicht umschreiben kann, sodass auch das Abschneiden des Endes auffällt.

So weit reicht der Nachweis, und keinen Schritt weiter. Das Audit-Log ist eine Hash-Kette, keine Signatur. Es macht internes Manipulieren erkennbar, aber es beweist nicht, dass genau eine bestimmte Person und niemand sonst einen Eintrag erzeugt hat. Wer lokalen Schreibzugriff auf die Datei und dieselbe Hash-Funktion hat, könnte die Kette ab einer Stelle neu berechnen. Für eine gerichtsfeste Unabstreitbarkeit wäre die geplante Signatur mit Sigstore nötig. Die ist vorgesehen, aber noch nicht gebaut. Lesen Sie das Log daher als manipulationsempfindlich im Innenverhältnis und über den Merge Request am Git-Server verankert, nicht als gerichtsfesten Beweis darüber, wer gehandelt hat.

## Menschliche Aufsicht

Der Agent entscheidet nichts allein. Jede Änderung und jeder Merge hält an und wartet auf eine namentliche Freigabe, bevor etwas wirksam wird. Die Freigabe erfolgt entweder im Terminal oder über die Oberfläche im Web-IDE, in der eine nicht-technische Person den Diff sieht und zustimmt. Die Extension für diese Oberfläche ist gebaut und getestet. Der gehostete Browser-Zugang darauf, also der Weg über eine echte GitLab-Web-IDE, ist entworfen, aber noch nicht bereitgestellt; er braucht noch DNS und einen Caddy-Server. Eine nicht-technische freigebende Person nutzt die Oberfläche heute also lokal, nicht über eine gehostete Adresse.

Ein ehrlicher Punkt dazu: Wer freigeben darf, lässt sich in der Policy-Datei als Genehmiger-Rolle hinterlegen, und die CLI setzt sie inzwischen durch. Bei einem echten GitLab- oder GitHub-Konto liest die CLI die Identität der freigebenden Person aus dem Zugangs-Token (GET /user), also aus einer authentifizierten Quelle statt aus einem selbst gesetzten Namen. Berührt eine Änderung einen Pfad mit hinterlegten Genehmigern, wird der Merge blockiert, wenn die Person nicht auf der Liste steht, und ein merge_denied-Eintrag landet in der Kette. Das gilt für die Kommandozeile. Die Web-IDE-Extension prüft die Genehmiger-Liste heute noch nicht, dort ist der Name weiter selbst angegeben. Eine organisationsweite Identität über ein einziges SSO für alle Oberflächen und eine Sigstore-Signatur für gerichtsfeste Unabstreitbarkeit sind geplant, nicht gebaut. Solange die Extension-Seite nicht verdrahtet ist, trägt dort die organisatorische Kompensationsmaßnahme: Ein zweiter benannter Mensch prüft den Diff, bevor die freigebende Person zustimmt.

Was heute erzwungen wird, ist die Pfad-Berechtigung. Die Policy-Datei steuert, welche Pfade ein Agent überhaupt schreiben darf, und blockiert alles außerhalb.

## Mitbestimmung

Eine KI, die an Dokumenten mitarbeitet, berührt Mitbestimmung. Betriebsrat oder Personalvertretung sollten früh, in der Design-Phase, einbezogen werden und nicht erst beim Rollout. werknario kommt dem entgegen, weil jede Aktion als nachlesbarer, freigegebener Diff protokolliert ist, an dem sich eine Betriebsvereinbarung überprüfbar orientieren kann.

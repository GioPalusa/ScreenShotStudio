# Textplacering i App Store-bilder

Analyserat 2026-11-12. Omfattning: användarens sju Applekällor, kompletterande primärkällor och den befintliga Orbit Club-serien. Detta är en analys och ett förslag till experiment, inte en genomförd konverteringsstudie. Inga bilder eller produktfunktioner ändrades i denna research.

## Beslut som analysen stödjer

Optimera i denna ordning: begripligt huvudbudskap, läsbarhet i visningsstorlek, ett tydligt visuellt bevis från appen, därefter finjustering av placering. Underlaget fastställer ingen universell vinnare mellan överkant, underkant eller sidoplacering.

För Orbit Club rekommenderas en stor rubrik ovanför appbilden som första designkandidat, färre små textrader och större fokus på den funktion som rubriken lovar. Överkantsplaceringen är en arbetshypotes för just denna serie. Den ska jämföras med alternativ, inte göras till en generell regel i MCP:n.

## Vad de sju Applekällorna faktiskt bidrar med

| Källa | Relevant slutsats och avgränsning |
| --- | --- |
| [Manage your App Store assets](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-your-app-store-assets) | Asset Library hanterar screenshots och separata kreativa tillgångar. De senare kan användas för sidhuvud och sökresultat. Assettyp och placering måste därför vara kända innan vi föreslår textytor. |
| [Asset best practices, inklusive Format](https://developer.apple.com/app-store/asset-best-practices/#format) | Korta texter ska förstärka bilden, ha tydligt fokus och förbli läsbara i olika presentationer. Viktiga delar behöver klara beskärning. Mallarnas säkerhetsytor och App Store Connect Preview är bättre kontroll än påhittade universella pixelmarginaler. |
| [Discoverability](https://developer.apple.com/app-store/discoverability/) | Apples beskrivning av sökrelevans avser bland annat titel, keywords och kategori samt användarbeteende. Sidan belägger inte att text inbakad i screenshotbilder ger samma sökindexering. Screenshotcopy bör här optimeras för förståelse och konvertering. |
| [Creating your product page](https://developer.apple.com/app-store/product-page/) | Visa verklig appanvändning. När ingen app preview finns kan de första en till tre bilderna visas i sökresultat beroende på orientering. Följande bilder bör fokusera på varsin viktig fördel eller funktion. |
| [Showcase your apps with new assets](https://developer.apple.com/news/?id=ljpl7kyn), 5 oktober 2026 | Nyheten introducerar nya kreativa tillgångar, Asset Library och förhandsvisning över enheter, orienteringar och ljust/mörkt läge. Det stärker behovet av placeringsspecifika förhandsvisningar. Ingen studie av optimal rubrikposition redovisas. |
| [Tech Talk 110361: Make the most of custom product pages](https://developer.apple.com/videos/play/tech-talks/110361/) | Målgrupp, förväntning från annonsen och innehåll på produktsidan behöver hänga ihop. Apple rekommenderar att åtminstone de två första bilderna anpassas. Fallen gäller hela kreativa upplägg och trafiksegment, inte isolerad textplacering. |
| [Tech Talk 10886: Get started with custom product pages](https://developer.apple.com/videos/play/tech-talks/10886/) | Matcha målgrupp och kampanjbudskap med relevant appfunktion. Analysera även retention. Detta är strategisk vägledning, inte ett experiment som jämför text överst och nederst. |

Videorna granskades genom Apples publicerade transkript, inte genom bildruta-för-bildruta-analys. Nyhetsartikelns fulltext kunde läsas i sökverktygets indexerade Apple-resultat; direktöppningen misslyckades. Äldre uppgifter om produktgränser och annonsformat i videorna ska inte användas som aktuella tekniska krav.

Viktig skillnad: säkerhetsytor för nya kreativa tillgångar ska inte automatiskt appliceras som obligatoriska zoner på alla screenshots. En screenshot ska fortfarande visa appen i användning. Nyheterna om kreativa tillgångar ger fler möjligheter att uttrycka varumärket, inte ett skäl att ersätta appbeviset med affischtext. Se [asset-hanteringen](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-your-app-store-assets).

## Kompletterande evidens

Leverantörernas utvalda framgångsfall kan ge testhypoteser men visar inte vad varje app kommer att vinna på. Två användbara exempel:

- ŠKODA Little Driver: drygt 1 200 besökare under 30 dagar. Ändrad bildordning rapporterades ge +6,4 %. Testet använde Facebooktrafik till replikerade butikssidor och publicerades 2015; inga fullständiga osäkerhetsintervall redovisas. Det motiverar att testa första bildens innehåll, inte en viss rubrikposition. [Förstahandsredovisningen hos Sensor Tower](https://sensortower.com/blog/case-study-how-a-slash-b-testing-can-improve-your-apps-conversion-rates)
- SongPop2: ett 30-dagarstest rapporterade +10 % för en variant med större och kortare rubriker, men också ändrade figurer, färger och gameplay. Urvalet redovisas inte. Det stödjer en testhypotes om förenkling; ingen generell treordsregel. [SplitMetrics och FreshPlanet](https://splitmetrics.com/customers/freshplanet-optimizes-ios-screenshots/)

Fullständig evidenstabell med ytterligare källor finns i bilagan nedan.

Även Apples eget FunPlus-fall redovisar 33 % högre konvertering tillsammans med ändrade screenshots och mer riktad marknadsföring. Det kan inte tillskrivas rubrikens position eller storlek. CBS Sports-fallet ändrade säsongsinnehåll och jämförde även utfall år över år. Sådana siffror ska inte användas som en prognos för Orbit Club. [Apples transkript](https://developer.apple.com/videos/play/tech-talks/110361/)

## Faktisk granskning av Orbit Club

Underlag: `output/orbit-club/preview-result.json`, projektets `studio.json` och den exporterade kontaktkartan. Fyra bilder i 2064 × 2752 px med designyta 1032 × 1376. Alla fyra använder samma fem textnivåer: varumärke, liten avsnittsetikett, huvudrubrik, stödtext och sidfot.

Den här tabellen visar beräknad nominell teckenstorlek efter proportionell skalning, inte uppmätt bokstavshöjd eller en bestämd App Store-storlek:

| Textnivå | Designstorlek | Vid bildbredd 160 px | Vid bildbredd 240 px |
| --- | ---: | ---: | ---: |
| Varumärke | 34 | 5,27 | 7,91 |
| Avsnittsetikett | 20 | 3,10 | 4,65 |
| Huvudrubrik | 90 | 13,95 | 20,93 |
| Stödtext | 27 | 4,19 | 6,28 |
| Sidfot | 20 | 3,10 | 4,65 |

Formel: renderad teckenstorlek × förhandsvisningsbredd / 1032. Bredd 160 och 240 px är diagnostiska teststorlekar; faktisk presentation varierar. Alla fyra rubriker återges med 90 designpx och två rader utan krympning enligt renderingsrapporten.

Huvudrubrikens yta börjar 15,7 % ned i bilden, stödtexten vid 34,4 % och iPad-bilden vid 43,6 %. En stor del av den övre ytan används alltså för flera textnivåer före själva appbeviset. Den liggande iPadens hela gränssnitt skalas dessutom in i en stående bild, vilket gör dess detaljtext liten.

Beräknad kontrast för opaka textfärger mot enfärgade bakgrunder: ljus huvudrubrik 10,38:1, ljus stödtext 4,70:1, mörk huvudrubrik 10,29:1 och mörk stödtext 7,61:1. Beräkningen följer relativ luminans enligt sRGB/WCAG. Den avser färgparen, inte alla kanter, skuggor eller pixlar i den exporterade bilden. God kontrast kompenserar inte för för liten visningsstorlek. [W3C:s förklaring av textkontrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

### Föreslagen layout

1. Behåll en tydlig huvudrubrik, normalt högst två rader som startvärde. Första bilden måste säga vad appen hjälper personen att göra.
2. Ta bort avsnittsetiketten och sidfotstexten i den förenklade varianten. Låt stödtexten vara valfri; huvudbudskapet måste fungera även när den inte går att läsa. Varumärket kan finnas som liten signatur utan att bära funktionell information.
3. Flytta upp och förstora appbilden med den frigjorda ytan. Visa uppgiftslistan, timern, galaxens progression respektive loggboken tydligare. Undvik att täcka det gränssnitt som bevisar rubrikens påstående.
4. Börja med vänsterställd rubrik i den förenklade designkandidaten för att ge rubrik och appbild en gemensam kant. Det är ett designval att utvärdera; nuvarande centrerade text är inte visad sämre i något experiment här.
5. Behåll Bézierbanorna, de mjuka skuggorna och de rundade hörnen som sekundära formelement. Orbitbanan kan rama in motivet, men ska inte gå genom text eller konkurrera med det viktigaste i appen. Om sidfotstexten försvinner kan den rundade plattan tas bort eller få en tydlig visuell funktion.
6. Testa en separat liggande screenshotserie när den liggande iPad-appen behöver mer läsbar UI-yta. Ändrad orientering är ett eget experiment eftersom även butikens presentation kan ändras.

### Tydligare budskap att prova

Förslag, inte färdigvaliderad copy eller garanterade förbättringar:

| Bild | Nuvarande rubrik | Konkretare kandidat | Visuellt bevis |
| --- | --- | --- | --- |
| Mission control | Make room for a little wonder. | Turn daily tasks into missions. | Dagens uppgifter och en slutförd mission |
| Focus capsule | One mission. All your attention. | Make space to focus. | Aktiv fokustimer |
| My galaxy | Small wins. New worlds. | Turn small wins into new worlds. | Planeter som motsvarar framsteg |
| Flight log | Keep the bright moments. | Keep a journal of your day. | En faktisk loggboksanteckning |

Första rubriken har störst behov av funktionell tydlighet: nuvarande ord kan beskriva många slags appar. Rymdtemat kan ligga kvar i bildspråk och produktord utan att läsaren behöver avkoda appens kategori. Galaxbildens formulering bör bara användas om verklig produktfunktion motsvarar progressionen; Orbit Club är fortfarande ett fiktivt koncept.

## Experiment som kan avgöra vad som fungerar

| Prioritet | Hypotes | Det som ändras | Det som hålls lika |
| --- | --- | --- | --- |
| 1 | Konkret nytta gör första bilden begripligare | Rubriktext, först bild 1 | Placering, storlek, UI, färger och bildordning |
| 2 | Färre små textrader ger tydligare fokus | Avsnittsetikett, stödtext och sidfot tas bort | Huvudrubrik och appbildens geometri |
| 3 | Appbeviset behöver mer plats | Appbildens storlek/utsnitt | Rubrik, textmängd och färger |
| 4 | En annan rubrikposition fungerar bättre | Övre respektive nedre textblock; motivet flyttas motsvarande | Samma text, typsnitt, storlek och bildskala; undvik olika överlapp |
| 5 | Annan justering fungerar bättre | Vänsterställt respektive centrerat | Samma textyta och övrig komposition |

Om flera ändringar lanseras samtidigt kan vi bedöma hela designpaketet men inte avgöra vilken ändring som orsakade resultatet. Genomför först ett enkelt begriplighetstest: visa en liten bild för personer som inte känner konceptet och be dem beskriva appens syfte och nyttan. Det är kvalitativ diagnos, inte konverteringsbevis.

När en verklig app finns: använd randomiserad Product Page Optimization för standardproduktsidan. Förhandsbestäm mål, målgrupp och minsta intressanta förbättring; läs konvertering, relativ förbättring och osäkerhetsintervall tillsammans. Apples rapport markerar bättre/sämre utfall från 90 % konfidens. Fem tillskrivna hämtningar räcker för att ett test ska synas, inte för att på egen hand utse en vinnare. [Aktuell PPO-analysdokumentation](https://developer.apple.com/help/app-store-connect-analytics/acquisition/product-page-optimization)

Custom Product Pages kan därefter pröva exempelvis planering respektive fokus som ingång. Rå skillnad mellan två sidor med olika trafikkällor isolerar inte designens effekt. Behåll samma trafikfördelning där en kausal jämförelse behövs och följ kvalitet efter installation. [Strategin i Apples introduktionsvideo](https://developer.apple.com/videos/play/tech-talks/10886/)

## Vad Screenshot Studio och MCP:n bör hjälpa till med

Detta är förslag till nästa implementation, inte funktioner som tillkommit i denna research:

- **Visningsstorlek i textinspektion:** rapportera faktisk renderad fontstorlek, radantal, krympning och beräknad storlek vid angivna förhandsvisningsbredder. Skilj overflow från läsbarhetsrisk; en text kan passa perfekt och ändå bli mycket liten.
- **Förhandsvisningar per placering:** screenshotkarusell, sökresultat och kreativa tillgångar behöver egna profiler. Dokumentera källa, datum, orientering och beskärningsmask för mallar. Kontrollera slutligen i Apples Preview.
- **Kontrast och hierarki:** mät text mot relevant bakgrund och flagga osäkra fall vid bilder/gradienter. Föreslå färre informationsnivåer, men presentera inte numeriska typsnittströsklar som Applekrav.
- **Lokalisering:** kontrollera varje språk och dess faktiska radbrytning, fallback och eventuell krympning. Använd inte engelsk ordlängd som universell budget. Låt RTL-språk få en genomtänkt layout och bevara draft-status för maskinskriven copy.
- **Experimentvarianter:** skapa spårbara kopior med hypotes, enda avsedda skillnad och exportmanifest. Skilj kvalitetsråd från tekniska exportblockerare.
- **Semantisk granskning:** MCP:n bör kunna förklara vilken nytta första bilden uttrycker, vilken appfunktion som styrker den och vad den faktiska källan stödjer. Den ska inte utlova konverteringslyft från generella designregler.

## Begränsningar

Inga experiment med verkliga App Store-besökare har genomförts för Orbit Club. Läsbarhet har analyserats genom geometri, färgberäkning och visuell granskning; inte genom användartest eller Apple Preview i ett App Store Connect-konto. Tekniskt godkänd export är inte bevis på marknadsföringseffekt eller App Review-godkännande.


---

## Bilaga: extern evidens


Kontrollerat 2026-11-12. Avgränsning: primärkällor utanför Apple, med fokus på text, ordning, läsbarhet och konvertering. Kundfallen nedan är leverantörernas egna redovisningar, inte oberoende replikationer. Alla procentsiffror är rapporterade utfall för respektive fall, inte prognoser för Screenshot Studio eller Orbit Club.

## Evidenstabell

| Primärkälla och datum | Urval och metod | Vad källan faktiskt visar | Begränsning och användning |
|---|---|---|---|
| [Bamboo Apps + SplitMetrics: ŠKODA Little Driver, publicerat hos Sensor Tower](https://sensortower.com/blog/case-study-how-a-slash-b-testing-can-improve-your-apps-conversion-rates), juli 2015 | Drygt 1 200 besökare under 30 dagar. Facebookannonser till replikerade butikssidor med kontroll och tre alternativ. | Omordning med ”Drive Mode” först rapporteras ge 6,4 % fler installationer än kontrollen. Genomsnittlig galleriskroll var 17 %. | Historiskt butiksgränssnitt, betald trafik, inga fullständiga rådata eller konfidensintervall i texten. Författarna antar överförbarhet från replika till butik. Stöd för att testa första bildens budskap och ordning; skrollandelen är inte en generell App Store-siffra. |
| [SplitMetrics + FreshPlanet: SongPop2](https://splitmetrics.com/customers/freshplanet-optimizes-ios-screenshots/), odaterad sida | Två sidversioner, 30 dagar. Antal deltagare och tilldelningsmetod redovisas inte. | Ett paket med större/kortare rubriker, förändrade figurer, färger och gameplay-bilder rapporteras prestera 10 % bättre. | Textens längd, storlek och placering isoleras inte. Testets treordsgräns är en kreativ variant, inte en bevisad optimal gräns. Kan motivera ett test av en enklare, tydligare helhet. |
| [SplitMetrics + FiftyThree: Paper](https://splitmetrics.com/customers/fiftythree-localizes-screenshots-for-app-store/), odaterad sida | Test av iPhone-bilder för kinesisk målgrupp: ordning, bakgrunder och engelska/kinesiska texter. Stickprov, datum och osäkerhetsintervall saknas. | Lokaliserade bilder rapporteras prestera 33 % bättre än engelska. Även ordning och bakgrund testades. | Oklart hur övriga ändringar hölls konstanta i varje jämförelse. Appen finns på iPad, men detta experiment beskrivs för iPhone. Stöd för att testa lokaliserad kommunikation, inte för en viss svensk radlängd. |
| [Storemaven: App Store Screenshots Best Practices](https://www.thestoremaven.store/academy/aso-screenshot-guide/), 2022-01-19 | Egen sammanställning som uppges bygga på över fem års tester och 500 miljoner sessioner. | Prioriterar de först synliga bilderna och hypoteser om olika kundnyttor. Behandlar enbart fontbyte som en svagare hypotes än ett tydligt förändrat värdebudskap. | Urvalsram, appfördelning, rådata och aggregeringsmetod publiceras inte. Blandar observationer och råd. Stor totalsiffra gör inte råden till kausala bevis. Använd som hypoteskälla; upprepa inte dess ”3–6 sekunder” som universell lag. |
| [W3C: Understanding SC 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), levande WCAG 2.2-förklaring | Tillgänglighetsstandard och förklarande vägledning, inget konverteringstest. | Text och text i bilder: normalt minst 4,5:1; stor text 3:1. Tunna tecken kan bli praktiskt svagare genom kantutjämning. Bildredigerarens punktstorlek kan inte ensam fastställa hur stor texten blir för läsaren. | Ett användbart läsbarhetsriktmärke, inte Apples godkännandekrav för skärmbilder eller bevis för högre CVR. Bedöm den faktiska visningen efter nedskalning och kontrasten mot bakgrunden bakom texten. |
| [Appfigures: 16 A/B Tests You Must Try](https://appfigures.com/resources/guides/ab-tests-you-must-try-aso-experiments), 2021-03-30 | Praktikerguide med exempel, inget publicerat stickprov eller kontrollerat placeringsresultat. | Föreslår att testa textlängd, typografi, placering och avstånd; betonar att målgrupper skiljer sig. | Expertråd, inte experimentell evidens för att överkant slår underkant. Även dess kategoriska påstående om texters närvaro saknar redovisad metod. |

## Slutsatser att använda i design och MCP-vägledning

1. **Överkant kontra underkant är en testhypotes.** Sökningen och de lästa primärkällorna gav inget redovisat kontrollerat test som isolerar just detta och etablerar en generell vinnare. Börja med en lugn, konsekvent textyta som inte täcker den funktion bilden ska visa. Testa placeringen med samma text, storlek, kontrast och skärminnehåll. Detta är en rekommenderad försöksdesign, inte ett belagt placeringsfacit.
2. **Gör den första bilden självförklarande.** ŠKODA-fallet ger mer konkret stöd för att ordningen kan spela roll än för en viss koordinat på texten. Lägg ett centralt värdebudskap där användaren möter det först; mät därefter i den faktiska butiken och målgruppen. [Förstahandsredovisning](https://sensortower.com/blog/case-study-how-a-slash-b-testing-can-improve-your-apps-conversion-rates).
3. **Kortare rubriker är en rimlig variant, ingen ordlag.** SongPop2 stöder att ett förenklat visuellt koncept kan fungera, men bevisar varken tre ord, versaler eller en bestämd fontstorlek. MCP:n bör beskriva exempelvis en kort huvudrubrik och valfri förklaring som en startpunkt och varna för överfull text genom faktisk visuell kontroll. [SongPop2](https://splitmetrics.com/customers/freshplanet-optimizes-ios-screenshots/).
4. **Mät läsbarhet i visningsstorlek.** Kontrollera exporten i sökresultatets och produktsidans ungefärliga storlek, inte bara vid 100 % på den stora arbetsytan. Använd helst minst 4,5:1 även för viktiga rubriker för en robust utgångspunkt; 3:1-undantaget kräver att texten verkligen visas stor. Ingen pixelstorlek i en 2064-pixelsbild är i sig ett universellt minimum. [W3C](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
5. **Språk och målgrupp ska ingå i testet.** Papers lokaliseringsresultat gör språkanpassning till en relevant hypotes. Längre översättningar behöver ny kontroll av radbrytning och visad storlek. Resultatet fastställer ingen universell vinst för varje språk. [Paper](https://splitmetrics.com/customers/fiftythree-localizes-screenshots-for-app-store/).

## Metodgränser

Äldre tredjepartstester kan mäta ett tryck på ”Get” i en webbreplika snarare än ett färdigt appnedladdningsförlopp. [Storemavens egen metodbeskrivning](https://www.thestoremaven.store/glossary/replicated-app-store-page/) anger betald trafik till repliker och vidarebefordran till verklig butik. Sidans uppgift att Apple saknar inbyggda tester är historisk och används inte som aktuell produktfakta här. Samma föråldrade uppgift finns hos [Appfigures](https://appfigures.com/resources/guides/ab-tests-you-must-try-aso-experiments); dess förslag om tidssekventiell före/efter-jämförelse är inte samma sak som ett samtidigt randomiserat experiment och används inte som aktuell testinstruktion.

Ett nyare [textPlus-fall](https://splitmetrics.com/customers/how-textplus-got-119k-installs-from-a-single-screenshot-change/) granskades också. Det beskriver både metadataarbete och kreativa iterationer, men redovisar inte tillräcklig metod i löptexten för att tillskriva rubrikplacering eller textmängd en viss effekt. Därför används varken rubrikens +119 000 eller dess 59 % som evidens för textplacering.

Ingen av de granskade källorna fastställer en allmängiltig optimal textandel, marginalprocent, antal rader, fontstorlek eller ordräkning för iPad-skärmbilder. Sådana värden i en mall ska märkas som designval och granskas visuellt, inte presenteras som Apple-regler eller vetenskapligt optimum.

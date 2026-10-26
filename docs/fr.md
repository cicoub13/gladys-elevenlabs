# ElevenLabs

> **Nécessite Gladys 5.3 ou supérieur.**

Donnez à Gladys une voix naturelle grâce à [ElevenLabs](https://elevenlabs.io) :
les annonces de vos scènes (« La machine à laver a terminé », « Quelqu'un sonne
à la porte »…) sont lues sur vos enceintes Sonos, Google Cast ou AirPlay avec
la voix ElevenLabs de votre choix.

L'intégration est un **fournisseur de synthèse vocale** : une fois
sélectionnée comme voix de Gladys, elle remplace Gladys Plus pour parler, sans
abonnement Gladys Plus.

## Prérequis

- Un compte [ElevenLabs](https://elevenlabs.io). L'offre gratuite suffit pour
  essayer ; chaque annonce consomme des crédits ElevenLabs, environ un crédit
  par caractère (la moitié avec les modèles Flash et v4 Turbo). Voir les
  [abonnements](https://elevenlabs.io/pricing).
- Une enceinte connectée à Gladys : Sonos, Google Cast ou AirPlay.
- Gladys installé en mode réseau **host** (installation standard) : les
  enceintes téléchargent l'annonce directement sur Gladys, sur votre réseau
  local.

## Configuration

1. Dans ElevenLabs, ouvrez [Clés d'API](https://elevenlabs.io/app/settings/api-keys)
   et créez une clé. Une clé restreinte doit avoir au moins la permission
   **Text to Speech**, et **Voices : read** pour trouver une voix par son nom.
   La permission **User : read** permet en plus d'afficher les crédits
   restants.
2. Dans Gladys, ouvrez l'écran de configuration de l'intégration ElevenLabs et
   remplissez :

| Champ                         | Description                                                                                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Clé d'API**                 | La clé créée ci-dessus (`sk_…`).                                                                                                                                                                                       |
| **Voix (nom ou identifiant)** | Une voix de votre compte : son nom (`George` par défaut) ou son identifiant de 20 caractères. Les voix de la [bibliothèque](https://elevenlabs.io/app/voice-library) ajoutées à votre compte en font partie.           |
| **Modèle**                    | **Flash v2.5** (par défaut) : rapide, deux fois moins de crédits. **Multilingual v2** : le plus naturel. **v3** : le plus expressif. **v4** : la meilleure qualité. **v4 Turbo** : rapide, deux fois moins de crédits. |
| **Vitesse**                   | De 0,7 (plus lent) à 1,2 (plus rapide). 1 par défaut.                                                                                                                                                                  |
| **Stabilité**                 | De 0 (plus expressive et variée) à 1 (plus régulière). 0,5 par défaut.                                                                                                                                                 |

3. Enregistrez. L'état de connexion affiche par exemple `Connecté à ElevenLabs,
voix « George ». 8 500 crédits restants sur 10 000, renouvelés le 12
novembre.`
4. Ouvrez la page **Intelligence Artificielle** de Gladys et, dans la carte
   **Voix (fournisseur de synthèse vocale)**, choisissez **ElevenLabs**.

### Choisir une voix

Le bouton **Lister mes voix**, sous le formulaire, affiche le nom et
l'identifiant de toutes les voix de votre compte ; la voix utilisée est marquée
d'un ✓. Copiez un nom ou un identifiant dans le champ **Voix**, puis
enregistrez. La clé d'API doit être enregistrée avant d'utiliser le bouton.

Pour une nouvelle voix, parcourez la
[bibliothèque de voix](https://elevenlabs.io/app/voice-library), ajoutez-la à
votre compte, puis utilisez son nom ou son identifiant.

## Utilisation

Dans une scène, utilisez l'action **Parler sur une enceinte** : choisissez
l'enceinte et le texte à lire. Le texte peut contenir des variables de la
scène.

- La langue de la voix suit celle du texte. Avec tous les modèles sauf Multilingual v2, la langue de
  l'administrateur de Gladys est aussi transmise pour une meilleure
  prononciation.
- Une phrase déjà prononcée avec la même voix et les mêmes réglages est
  réutilisée sans consommer de crédits, tant que l'intégration n'a pas
  redémarré. Une même annonce sur plusieurs enceintes n'est synthétisée qu'une
  fois.
- Gladys lit au plus 2 000 caractères par annonce.

**Limite de l'assistant vocal** : avec ElevenLabs, les réponses de l'assistant
vocal dans le navigateur ou l'application restent écrites. L'audio est servi
par Gladys sur votre réseau local, en `http://`, et le navigateur refuse de le
lire dans une page sécurisée (`https://`). Les annonces sur les enceintes ne
sont pas concernées.

## Dépannage

L'état de connexion de l'écran de configuration affiche le problème. Une
annonce qui n'a pas pu être lue est notée dans les journaux de l'intégration
(`Speech not synthesized: …`), avec la raison en anglais.

**« Saisissez votre clé d'API ElevenLabs dans les paramètres de
l'intégration. »** Renseignez **Clé d'API** (voir « Configuration »).

**« ElevenLabs a refusé la clé d'API : vérifiez-la dans vos paramètres
ElevenLabs, puis enregistrez-la à nouveau ici. »** La clé est erronée ou a été
supprimée. Plus rien n'est demandé à ElevenLabs avant que vous enregistriez une
clé valide.

**« Cette voix n'est pas dans votre compte ElevenLabs : utilisez le bouton
« Lister mes voix »… »** Le nom ou l'identifiant du champ **Voix** ne
correspond à aucune voix de votre compte, ou la voix en a été retirée. Ajoutez
la voix à votre compte depuis la bibliothèque, ou choisissez-en une autre, puis
enregistrez.

**« La clé d'API ne peut pas lire vos voix… »** La clé restreinte n'a pas la
permission **Voices : read** : donnez-la-lui, ou saisissez l'identifiant de la
voix plutôt que son nom.

**« La clé d'API n'a pas le droit de faire cela (…) »** La clé n'a pas la
permission **Text to Speech**, ou votre abonnement n'inclut pas le modèle
choisi (le code entre parenthèses le précise, par exemple
`model_access_denied`). Changez les permissions de la clé ou le modèle.

**« Vos crédits ElevenLabs sont épuisés… »** Attendez le renouvellement
mensuel ou changez d'abonnement. L'état redevient « connecté » à la première
annonce réussie.

**« ElevenLabs est injoignable : vérifiez la connexion Internet de
Gladys. »**, **« ElevenLabs ne fonctionne pas pour le moment… »** Coupure
d'Internet ou panne d'ElevenLabs (voir son [état](https://status.elevenlabs.io)).

**L'état est « connecté » mais l'enceinte ne dit rien.** Vérifiez que
**ElevenLabs** est bien choisi dans la carte **Voix** de la page
**Intelligence Artificielle**, que l'intégration est démarrée, et que Gladys
tourne en mode réseau host : l'enceinte doit pouvoir joindre Gladys sur votre
réseau local. Les journaux du serveur Gladys signalent un réseau Docker en
pont.

## Confidentialité

- La clé d'API est stockée par Gladys comme un secret : elle n'est jamais
  réaffichée dans l'interface.
- Le texte des annonces est envoyé à ElevenLabs pour être lu. Voir la
  [politique de confidentialité d'ElevenLabs](https://elevenlabs.io/privacy-policy).
  Les annonces déjà prononcées sont gardées en mémoire par l'intégration,
  jamais sur disque.
- L'intégration ne communique qu'avec Gladys et l'API d'ElevenLabs
  (`api.elevenlabs.io`).

# OpenLanguageToolClient

English version: [README.md](README.md)

Client LanguageTool libre pour Thunderbird, conçu pour Thunderbird et rien d'autre.

## Pourquoi

L'extension officielle `languagetool-mailextension@languagetool.org` est en réalité l'extension navigateur universelle de LanguageTool, avec une poignée de lignes de Thunderbird greffées dessus. Elle embarque environ 150 adaptateurs de sites web (Gmail, Slack, Notion, Google Docs, ChatGPT...), une couche de reformulation IA, de la télémétrie Matomo, de l'A/B testing et une mécanique d'abonnement premium. Rien de tout cela n'a de sens dans un client de messagerie.

Quatre griefs motivent la réécriture.

1. **Elle n'est pas libre.** Chaque chunk du code est estampillé `(C) Copyright LanguageTooler GmbH. All rights reserved.` Aucun fichier de licence, aucun dépôt public, aucune source map.
2. **Sa configuration est bridée.** Elle ne permet pas de pointer une instance LanguageTool publique protégée par authentification. Le serveur personnalisé passe par un fichier de politique d'entreprise, pas par l'interface.
3. **Elle est lente sur les gros messages.** Elle envoie le corps entier au serveur, citations comprises. Sur un fil de dix échanges, cela veut dire réexpédier des dizaines de milliers de caractères de texte cité pour corriger les trois lignes réellement rédigées.
4. **Elle est encombrée de dispositifs commerciaux.** Teasers premium, statistiques d'écriture, suivi d'usage, tests A/B.

Un cinquième point figurait ici, affirmant qu'elle ne fonctionnait plus sur Thunderbird 155. C'était faux, et le constat mérite d'être posé à l'endroit où l'erreur se trouvait. La version installée (8.11.2, juillet 2024) déclare bien `strict_max_version: 130.*`, mais Thunderbird 155 l'active en relevant sa compatibilité à `157.*`. Sa partie privilégiée importe bien `resource://gre/modules/XPCOMUtils.jsm`, supprimé de Gecko depuis, mais l'import tient dans un `try` au `catch` vide et `Services` est de toute façon un global des contextes privilégiés modernes. L'extension officielle marche.

Ce projet ne répare donc pas une panne. Il remplace un outil qui fonctionne par un outil libre, sobre et rapide. C'est un choix, pas une nécessité, et le périmètre doit s'en souvenir.

## Ce que fait ce projet

Il souligne les erreurs détectées par un serveur LanguageTool dans la fenêtre de composition, propose les corrections dans un panneau ouvert par un clic sur le mot souligné ou dans le menu contextuel, et se tait.

Le soulignement est pointillé et porte la couleur du type d'erreur, une couleur pour chacune des cinq familles : orthographe, grammaire, typographie, style et le reste. Ces mêmes couleurs marquent le panneau, les entrées du menu contextuel et les lignes de la liste, pour qu'un type d'erreur se présente partout de la même façon.

Le bouton de la barre d'outils dit l'état dans son icône : le logo quand il n'y a rien à signaler, un anneau qui tourne pendant une vérification, un anneau marqué d'un point d'exclamation quand le serveur n'a pas pu être joint, et une pastille qui compte les erreurs trouvées. Son menu réunit la langue et une nouvelle détection de celle-ci, une vérification de tout le message, le mode pointilleux, un interrupteur qui sort le message en cours de la vérification, et les réglages.

Une fenêtre à part liste toutes les erreurs du message, ouverte par la première entrée de ce menu ou par un raccourci clavier. Une ligne par erreur, dans l'ordre du texte : l'extrait où elle se trouve, de quel type elle est, combien de texte une correction toucherait, l'explication entière et un bouton par remplacement. Les flèches du clavier parcourent la liste.

Outre le serveur et la langue, les réglages portent l'épaisseur du soulignement, en trois niveaux, et le temps d'arrêt de l'écriture avant qu'une vérification ne parte, en secondes et borné aux deux extrémités. Un second raccourci clavier demande une vérification sans attendre cette pause.

## Ce qu'il ne fera pas

Reformulation IA, synonymes, statistiques d'écriture, suggestions d'emoji, télémétrie, tests A/B, comptes et abonnements, support des sites web hors Thunderbird.

Rien n'est prévu pour la version payante de LanguageTool, gardez l'extension officielle.

## Licence

GNU General Public License v3.0 ou ultérieure. Voir `LICENSE`.

## Contribuer

[CONTRIBUTING.md](CONTRIBUTING.md) rassemble la philosophie, les conventions, les règles de test et le cycle de contribution. Les assistants IA et les outils agentiques lisent d'abord [AGENTS.md](AGENTS.md), qui fixe les règles qui s'imposent à eux.

# Visio — Application signataire (client session)

**Ce dépôt contient uniquement** l’app Next.js côté **signataire** : KYC, salle d’attente, visio Daily, signature YouSign.

- **Dashboard notaire / outil notaire** : dépôt séparé — [jeremy-arh/notary](https://github.com/jeremy-arh/notary). Ne pas y mélanger ni cloner dans ce repo.
- **Schéma base de données / migrations SQL** : appliqués dans le projet Supabase (ou autre dépôt dédié), pas versionnés ici.

## Prérequis

```bash
npm install
```

Copiez `.env.example` vers `.env.local` et renseignez les variables (Supabase, JWT, URL app, etc.).

## Développement

```bash
npm run dev
```

L’app écoute le port **3011** (voir `package.json`).

## Flux signataire (aperçu)

1. Accueil / session de test → KYC (Veriff si activé)  
2. Salle d’attente → Room (visio + document + signature)  
3. Page terminée / téléchargements selon configuration  

## API utiles (extraits)

- `POST /api/session/create` — création de session  
- Routes sous `/api/session/[sessionId]/…` — état de signature, document, YouSign, audit, etc.  
- KYC : `/api/kyc/*`  

Pour Veriff, voir les variables `NEXT_PUBLIC_VERIFF_*` et `VERIFF_*` dans `.env.example` / documentation produit.

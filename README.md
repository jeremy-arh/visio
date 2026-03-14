# My Notary — Outil de notarisation à distance

## Setup complet (5 minutes)

### 1. Installer les dépendances

```bash
npm install
```

### 2. Configurer Supabase

1. Créez un projet sur [supabase.com](https://supabase.com)
2. Copiez `.env.example` vers `.env.local`
3. Renseignez vos clés Supabase dans `.env.local` :

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
JWT_SECRET=une-cle-secrete-min-32-caracteres
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Créer les tables et données

Dans le **SQL Editor** du dashboard Supabase, exécutez le contenu du fichier :

```
supabase/setup_complet.sql
```

Ce script crée les tables (notaries, notarization_sessions, session_signers) et insère les données de test.

### 4. Lancer l'application

```bash
npm run dev
```

Ouvrez [http://localhost:3000](http://localhost:3000)

### 5. Tester

Cliquez sur **"Démarrer une session de test"** → vous êtes redirigé vers le flux KYC → Confirmer identité → Salle d'attente.

---

## Flux signataire

1. **Accueil** → "Démarrer une session de test" (crée une session et redirige)
2. **KYC** → Confirmer mon identité
3. **Salle d'attente** → Realtime sur le statut
4. **Room** → Visio + document + signature (quand configuré)
5. **Terminé** → Téléchargement du document signé

## Vérification d'identité (Veriff)

Pour activer la vérification d'identité via Veriff :

1. Créez un compte sur [Veriff](https://veriff.com) et une intégration
2. Ajoutez dans `.env.local` :

```env
NEXT_PUBLIC_VERIFF_ENABLED=true
VERIFF_API_KEY=votre-api-key
VERIFF_API_URL=https://stationapi.veriff.com
VERIFF_WEBHOOK_SECRET=votre-shared-secret
```

3. Dans le **Veriff Customer Portal** → Intégrations → Settings :
   - **Webhook decisions URL** : `https://votre-domaine.com/api/kyc/webhook`
   - En local : utilisez [ngrok](https://ngrok.com) pour exposer votre serveur et configurer l’URL du webhook

4. Exécutez la migration `supabase/migrations/20240310000003_add_veriff_session_id.sql` si ce n’est pas déjà fait (ou `setup_complet.sql` qui inclut tout)

Le flux KYC affichera alors le bouton « Lancer la vérification Veriff » et l’embedd Veriff InContext. La décision (approved/declined) est reçue via le webhook et met à jour automatiquement `kyc_status` et le statut de la session.

## API

- `POST /api/session/create` — Création session (order_id, signers, document_url, notary_id)
- `GET /api/test/create-session` — Crée une session de test et redirige vers le flux
- `POST /api/kyc/veriff-session` — Crée une session Veriff et retourne l’URL (quand Veriff activé)
- `POST /api/kyc/webhook` — Webhook Veriff pour recevoir les décisions (decision webhook)

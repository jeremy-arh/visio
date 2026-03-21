# Notary Dashboard (isolé)

Projet Next.js autonome pour le dashboard notaire, destiné à un domaine dédié.

## 1) Installation

```bash
cd notary-dashboard
npm install
```

## 2) Variables d'environnement

Copier `.env.example` vers `.env.local` puis renseigner:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `DAILY_API_KEY`
- `NEXT_PUBLIC_MAIN_APP_URL` (URL du front principal qui héberge `/session/[id]/room`)
- `NEXT_PUBLIC_MAGIC_LINK_REDIRECT_URL` (URL absolue du callback notaire)

## 3) Lancement

```bash
npm run dev
```

Le dashboard démarre sur `http://localhost:3010`.

## 3bis) Auth Magic Link

- Le login est sur `/login`.
- Connexion via `supabase.auth.signInWithOtp`.
- Callback: `/auth/callback`.
- Le dashboard `/dashboard` exige une session Supabase active.
- L'email connecté doit exister dans `public.notary.email`.

### Important (multi sous-apps / même domaine)

Si tu as plusieurs sous-apps avec le même projet Supabase Auth, configure impérativement:

1. **Supabase Auth > URL Configuration > Redirect URLs**  
   Ajouter l'URL dédiée notaire:
   - `https://notary.tondomaine.com/auth/callback`
   - et en local `http://localhost:3010/auth/callback`

2. **Variable d'env du dashboard notaire**  
   `NEXT_PUBLIC_MAGIC_LINK_REDIRECT_URL=https://notary.tondomaine.com/auth/callback`

Sinon Supabase peut rediriger vers le `Site URL` global (souvent le dashboard client).

## 4) Lien notaire depuis l'app principale

Dans l'app principale, la création de session renvoie désormais un lien notaire vers:

`<NOTARY_DASHBOARD_URL>/login`

Configurer `NOTARY_DASHBOARD_URL` dans l'app principale (ex: `https://notary.yourdomain.com`).

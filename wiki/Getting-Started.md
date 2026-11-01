# Getting Started

This guide takes a clean machine with Git and Docker Compose to a shareable
WorldForge article. It uses the supported Docker installation and local-only
defaults.

## 1. Start WorldForge

```bash
git clone https://github.com/emorgan33/worldforge.git
cd worldforge
cp .env.example .env
docker compose up -d --build
```

Open <http://localhost:3033>. The container applies database migrations during
startup. If it is still starting, inspect it with `docker compose ps` and
`docker compose logs worldforge`.

## 2. Create the first account

```bash
docker compose exec worldforge pnpm auth:setup
```

Open the printed `/setup#token=...` URL. The token is a credential: do not put
it in chat, logs, screenshots, or issue reports. Choose the account email and
password, then sign in at `/login`.

On an empty database, this command creates the first account. To create a
specific account later, use:

```bash
docker compose exec worldforge pnpm auth:setup -- --create you@example.com
```

## 3. Create a world

On the first-world screen:

1. Select **Create your first world**.
2. Enter a title and optional description.
3. Choose the D&D 5e 2014 or Pathfinder 2e Remaster rules profile.
4. Select **Create world**.

New worlds are private and empty. The world switcher in the author workspace
lets you create or move between additional worlds later.

## 4. Write an article

1. Select **New article** in the World contents sidebar.
2. Choose a template, enter a title, and write the article.
3. Leave it as a private draft while editing.
4. Save the article.

## 5. Publish and share

Public reading requires all three gates:

1. In the article editor, set **Status** to **Published**.
2. Set **Visibility** to **Public**, then save.
3. On the world home/settings view, enable public access for the world.

The article viewer then offers its public link. If any gate is closed, the
article is not publicly readable. Public output excludes GM note blocks and
campaign secrets.

## 6. Protect your data

The Compose volume `worldforge-data` contains both `/data/worldforge.db` and
`/data/assets`. Back up both as one recovery point. Do not copy a live SQLite
file; use the stopped-service procedure in the repository's
[backup guide](https://github.com/emorgan33/worldforge/blob/main/docs/backup-restore.md).

For a public server, continue with [Installation](Installation) before exposing
WorldForge to a network.

**Source owner:** `wiki/Getting-Started.md`; adapted from `README.md`,
`docs/deployment-configuration.md`, and current author UI.
**Verified against:** WorldForge commit `9050d94` (October 31, 2026).

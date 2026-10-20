## Running the local site

Use `pnpm build`, then `pnpm serve:local` to serve WorldForge at [localhost:3033](http://localhost:3033) independently of terminal sessions. See [local server lifecycle](docs/local-server.md) for logs, restart commands and startup behavior.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3001](http://localhost:3001) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Login Credentials

The seeded demo world includes a GM account for testing:

- **Email:** `lorekeeper@worldforge.dev`
- **Password:** `WorldForge123!`

This account has full access to the "Aethelgard: The Shattered Realm" campaign world with sample articles, statblocks, and categories.

## Documentation

- [Feature Improvements Checklist](docs/feature-improvements.md) - Implementation status and roadmap
- [Article Revisions](docs/article-revisions.md) - Server-side version history and recovery

## Testing

### Test server

Player-access integration tests require the dev server, not the production build:

```bash
# Start the dev server
WORLDFORGE_ORIGIN=http://localhost:3131 npx next dev --port 3131

# Run tests
WORLDFORGE_TEST_ORIGIN=http://localhost:3131 pnpm test
```

**Known constraint**: Next.js 16.4.1 production builds (next start) do not reliably read Cookie headers. Always use the dev server for tests.

### Test results

- player-access-api: 6/6 passing (membership, policies, audit, preview)
- auth-publication-api: 1/2 passing (account setup, pre-existing PATCH issue)
- world-export-import-api: covers current format
- pnpm build: clean compile

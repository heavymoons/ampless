# {{siteName}}

A blog site powered by [ampless](https://github.com/heavymoons/ampless), using the **Minimal** theme — a soft blue accent on a warm-neutral background, derived from shadcn/ui's color tokens.

## Getting Started

This project uses Amplify Gen 2 for the backend (Cognito, DynamoDB, S3) and Next.js for the frontend.

```bash
# 1. Install dependencies
npm install

# 2. Start a personal AWS sandbox (terminal 1)
#    Requires AWS credentials configured (`aws configure`).
#    First run takes ~5–10 min to provision resources.
#    Generates amplify_outputs.json when ready.
npx ampx sandbox

# 3. Start the Next.js dev server (terminal 2)
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## First admin user

Open [http://localhost:3000/login](http://localhost:3000/login) and click **Create admin account**. The first user to register is automatically added to the `ampless-admin` Cognito group.

After that, manage content from `/admin`:

- `/admin` — dashboard
- `/admin/posts` — list / create / edit posts (tiptap editor)
- `/admin/media` — upload images to S3

## Production deploy

```bash
git init && git add . && git commit -m "init"
git remote add origin <your-repo>
git push
# Then connect the repo to AWS Amplify Hosting in the AWS console.
```

## Customize

- `cms.config.ts` — site name, media delivery mode, plugins
- `app/` — Next.js App Router pages (`(public)/` for the blog, `(admin)/` for the CMS)
- `amplify/` — Amplify Gen 2 backend definitions (auth / data / storage)

## Plugins

Enabled: {{plugins}}

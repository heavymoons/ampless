> 日本語版: [12-setup-experience.ja.md](./12-setup-experience.ja.md)
> 
## 12. Setup Experience

### User Flow

```bash
$ npx create-ampless@latest

? Site name: my-blog
? Theme: Blog / Landing Page / Portfolio
? Auth method: Passkey / Email link / Cognito standard
? Plugins: [x] SEO  [x] Contact Form  [ ] Analytics
? Deployment: Local development / Amplify (AWS)

✅ Project generated
Next steps:
  cd my-blog
  npx ampx sandbox    # Start local development backend
  npm run dev          # Start frontend
```

The CLI wizard dynamically generates resource definitions under `amplify/`.
Users do not need to be aware of CDK running in the background.

### Production Deployment

```bash
git init && git add . && git commit -m "init"
git remote add origin <your-repo>
git push
# → Connect git repository in the Amplify console
# → Auto-build and deploy
```

### Comparison with EmDash

| Step | EmDash (Cloudflare) | This CMS (Amplify) |
|------|--------------------|--------------------|
| Initialize | `npm create emdash@latest` | `npx create-ampless@latest` |
| Local development | `npx wrangler dev` | `npx ampx sandbox` + `npm run dev` |
| Production deploy | `npx wrangler deploy` | Connect git in Amplify console |
| Account required | Cloudflare (free) | AWS (free tier available) |
| Biggest hurdle | wrangler configuration | AWS account + initial IAM setup |

### Distribution Methods

1. **npm create template** (primary): CLI wizard generates the project
2. **GitHub Template Repository**: Fork with the "Use this template" button
3. **CDK construct** (advanced): Add to an existing Amplify project

---

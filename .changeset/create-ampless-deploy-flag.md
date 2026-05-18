---
"create-ampless": minor
---

Add `--deploy` flag for end-to-end GitHub + Amplify Hosting setup. After scaffolding, the CLI can now `git init`, create + push to a GitHub repo (`gh repo create`), provision an Amplify Hosting app, create a `main` branch, kick off the first deploy, and optionally attach a custom domain (auto-detecting Route 53 hosted zones when present, or surfacing CNAME records to add manually).

Missing values are prompted interactively; fully-flagged invocations work for CI. New flags: `--deploy`, `--github-owner`, `--github-private`, `--github-token`, `--aws-profile`, `--aws-region`, `--domain`, `--subdomain`, `--skip-confirm`, plus `-h`/`--help`. A starter `amplify.yml` build spec also ships in the scaffolded project so non-`--deploy` users have a working starting point for later Amplify Hosting setup.

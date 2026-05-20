> English: [01-overview.md](./01-overview.md)
> 
## 1. プロジェクト概要

### コンセプト
AWS Amplify をネイティブターゲットとしたオープンソースCMS。
Cloudflare EmDash が Cloudflare Workers 向けに設計されているのと同じ位置づけで、AWS エコシステム向けの「EmDash的なもの」を目指す。

### 背景
- EmDash は Cloudflare Workers/D1/R2 にロックインされており、AWS ユーザーにとっては選びにくい
- AWS Amplify をネイティブターゲットとしたオープンソース CMS は現時点で空白地帯
- Amplify Gen 2 の TypeScript ファースト設計と相性が良い

### ターゲットユーザー
- AWS を既に使っている開発者・技術者
- WordPress のセキュリティ問題に疲弊しているチーム
- 非開発者の管理は v1 ではスコープ外（git push ベースの運用を前提）

---

---
"@ampless/admin": patch
---

amazon-cognito-identity-js は未使用の死蔵依存で、vulnerable な js-cookie@2
(GHSA-qjx8-664m-686j) を全 install に引き込んでいた。admin の認証は aws-amplify/auth
経由で本 package を使用しない。削除により依存ツリーから経路ごと除去。

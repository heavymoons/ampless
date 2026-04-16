# ampless

CMS core library for AWS Amplify.

> ⚠️ **Early development** — API is unstable.

## Overview

`ampless` is the core library that powers the ampless CMS. It provides content management APIs, plugin infrastructure, and Amplify backend definitions.

## Installation

```bash
npm install ampless
```

## Usage

```ts
import { defineConfig } from 'ampless'

export default defineConfig({
  site: {
    name: 'My Blog',
    url: 'https://example.com',
  },
  plugins: [],
})
```

## Requirements

- Node.js >= 20
- AWS Amplify Gen 2

## License

[MIT](../../LICENSE)

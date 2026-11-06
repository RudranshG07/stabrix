import { join } from 'node:path'
import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  env: { NEXT_PUBLIC_DEV_ACCOUNTS: process.env.NEXT_PUBLIC_DEV_ACCOUNTS ?? '' },
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  outputFileTracingRoot: join(process.cwd(), '..'),
  outputFileTracingIncludes: { '/api/deployment': ['../deployments/*.json'] },
  transpilePackages: ['@stabrix/sdk'],
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return cfg
  },
}

export default config

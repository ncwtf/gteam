#!/usr/bin/env node

import { main } from './index.js';

main().catch((error) => {
  console.error('MCP Server 错误:', error);
  process.exit(1);
});

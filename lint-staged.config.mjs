export default {
  '*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}': ['eslint --fix --max-warnings=0', 'prettier --write'],
  '*.{css,scss,html,json,jsonc,md,mdx,yaml,yml}': 'prettier --write',
};
